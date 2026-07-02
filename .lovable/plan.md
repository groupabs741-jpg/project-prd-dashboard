
# AurumInsight — Gold Price Monitoring Dashboard

Adaptasi PRD ke stack Lovable: **TanStack Start + Lovable Cloud (Supabase Postgres) + Edge Function cron** menggantikan Next.js 16 + TiDB + GitHub Actions. Semua fungsi PRD tetap terpenuhi. Visual mengikuti direction "Tactile assay hybrid" (Fraunces + Inter + JetBrains Mono, palet paper/brass/emerald).

## 1. Enable Lovable Cloud & buat schema

Aktifkan Cloud, jalankan migration:

- Tabel `gold_prices` (Postgres equivalent dari skema TiDB PRD §4):
  - `id bigserial pk`, `source text`, `material_type text`, `weight numeric(6,2)`, `sell_price numeric(15,2)`, `buyback_price numeric(15,2)`, `spread numeric(15,2) generated always as (sell_price - buyback_price) stored`, `recorded_date date`, `created_at timestamptz default now()`
  - `unique (source, material_type, weight, recorded_date)`
  - index `(source, material_type, weight, recorded_date desc)`
- Tabel `sync_runs` untuk log cron (source, status, item_count, error_message, ran_at)
- RLS: enable, tambahkan policy `TO anon SELECT` untuk kedua tabel (data publik non-sensitif, single-user personal use — sesuai PRD "Bukan multi-user / auth")
- GRANT SELECT ke `anon` dan `authenticated`, GRANT ALL ke `service_role`

## 2. Sync pipeline (Edge Function + pg_cron)

Karena Lovable tidak pakai GitHub Actions, sync dilakukan via **Supabase Edge Function** yang dijadwal **pg_cron** harian ~10:00 WIB (03:00 UTC).

- `supabase/functions/sync-gold/index.ts`:
  - Konstanta `SOURCES = ['anekalogam','galeri24','pegadaian','logammulia','hartadinataabadi']`
  - Loop tiap source, fetch `https://logam-mulia-api.iamutaki.workers.dev/api/prices/{source}` dengan jeda 500ms
  - Map response → upsert ke `gold_prices` via `.upsert(..., { onConflict: 'source,material_type,weight,recorded_date' })` (Postgres equivalent dari `INSERT ... ON DUPLICATE KEY UPDATE`)
  - Per-source try/catch: kegagalan satu source tidak menghentikan yang lain, dicatat di `sync_runs`
- `pg_cron`: `select cron.schedule('sync-gold-daily', '0 3 * * *', $$select net.http_post(...sync-gold url, auth header...)$$)`
- Endpoint manual trigger (server function `triggerSync`) untuk bootstrap awal & tombol "Sync sekarang" di UI

## 3. Server functions (data access layer)

Menggantikan Next.js API Routes. Semua di `src/lib/gold.functions.ts` pakai `createServerFn` dengan server publishable client (data publik, RLS anon):

- `getTodayPrices()` → semua source untuk tanggal terbaru per source (untuk KPI cards & tabel perbandingan)
- `getHistory({ source, materialType, weight, days })` → rentang 7/30/90 hari (untuk chart & perhitungan MA/RSI)
- `getSourceCatalog()` → daftar unik `(source, material_type, weight)` yang tersedia (untuk populate selector)
- `getLastSync()` → timestamp sync terakhir
- `triggerSync()` → invoke edge function (untuk tombol manual re-sync)

## 4. Frontend — satu route `/`

Ganti placeholder `src/routes/index.tsx`. Layout meniru direction "Tactile assay hybrid" persis (header + 4 KPI cards + comparison table 2/3 + analysis sidebar 1/3 + full-width chart + footer).

**Komponen:**
- `Header` — logo AurumInsight, timestamp last sync, range toggle (7/30/90 hari)
- `FilterBar` — selector Source, MaterialType (filtered by source), Weight (filtered by materialType)
- `KpiCards` — Harga Jual (avg), Buyback (avg), Spread %, Signal Status (badge emerald)
- `ComparisonTable` — semua source × selected weight, sortable, highlight row spread terkecil, badge "Terbaik"
- `HistoryChart` — Recharts LineChart, 2 seri (sell/buyback) + toggle overlay MA5/MA20
- `SignalPanel` — status badge (Data belum cukup / Indikasi Beli / Netral / Indikasi Jual) + alasan kualitatif (RSI value, MA cross state, spread trend) + disclaimer permanen

**Logika sinyal (client-side, `src/lib/signals.ts`):**
- `ma(values, period)` — simple moving average
- `rsi(values, period=14)` — Wilder's RSI
- `computeSignal(history)`:
  - Jika `< 20` data poin → return `{ status: 'insufficient', reason: 'Mengumpulkan data — sinyal aktif setelah ~20 hari (progress N/20)' }`
  - Hitung MA5, MA20, RSI14, spread mean 14d
  - Rule tabel:
    - RSI < 30 + MA5 < MA20 → "Indikasi Beli"
    - RSI > 70 + MA5 > MA20 → "Indikasi Jual"
    - Selain itu → "Netral"
  - Return reason string yang menyertakan angka konkret (mis. "RSI 27.4 jenuh jual, MA5 di bawah MA20")

## 5. Design system (src/styles.css)

Adopsi token dari prototype terpilih ke `@theme inline` + `:root`:

- Colors (oklch): `--background` #fcfbf7, `--foreground` #1a1917, `--muted` #6e6b65, `--brass` #9a844b, `--emerald` #064e3b, `--paper-edge` #e8e4d8
- Fonts via `<link>` di `__root.tsx` head (bukan @import CSS): Fraunces (display), Inter (sans), JetBrains Mono (mono)
- Register `--font-display/sans/mono` di `@theme`
- Keyframe `slide-up` + utility `.animate-reveal`

## 6. Root metadata

Update `__root.tsx` head: title "AurumInsight — Indeks Harga Emas Fisik Indonesia", description sesuai produk, og:title/description matching, twitter:card summary_large_image. (Tidak set og:image — biar hosting inject screenshot.)

## 7. TanStack Query wiring

Loader di `/` route memanggil `ensureQueryData` untuk `today`, `history`, `catalog`, `lastSync`. Komponen pakai `useSuspenseQuery`. Mutation untuk `triggerSync` invalidate semua query. Format angka pakai `Intl.NumberFormat('id-ID')`.

## 8. Bootstrap flow

1. Setelah cron pertama jalan, DB kosong → UI menampilkan empty state "Belum ada data. Klik Sync untuk mulai."
2. User klik "Sync sekarang" → edge function fetch 5 source → chart & tabel muncul dengan 1 data point
3. Selama < 20 hari data, panel sinyal menampilkan "Mengumpulkan data (N/20)"
4. Setelah cukup, sinyal MA/RSI aktif otomatis

---

## Technical notes (untuk saya)

- `logammulia` rawan diblok Cloudflare (per PRD §2.2) — per-source error handling di edge function menanganinya; row `sync_runs` mencatat kegagalan tanpa menghentikan source lain.
- Semua endpoint API pihak ketiga (`logam-mulia-api.iamutaki.workers.dev`) tidak butuh auth — tidak perlu secret tambahan.
- Data publik non-sensitif + single user → RLS `TO anon SELECT` cukup, tidak perlu auth flow. Roadmap v1.1 (Telegram notif) & v2.0 (XAU spot, forecasting) tidak dibangun di v1.0 ini.
- Out of scope v1.0 (per PRD): treasury/sakumas/indogold, notifikasi otomatis, ML forecasting.

Setelah kamu approve, saya enable Lovable Cloud, jalankan migration, deploy edge function + pg_cron, dan bangun UI-nya sekaligus.
