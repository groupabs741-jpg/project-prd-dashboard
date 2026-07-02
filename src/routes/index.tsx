import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getCatalog,
  getHistory,
  getLastSync,
  getTodayPrices,
  triggerSync,
  type CatalogEntry,
  type PriceRow,
} from "@/lib/gold.functions";
import { computeSignal } from "@/lib/signals";
import { formatDateID, formatDateTimeID, formatDelta, formatIDR, formatPct, formatSourceName } from "@/lib/format";

const catalogQuery = queryOptions({
  queryKey: ["catalog"],
  queryFn: () => getCatalog(),
});
const lastSyncQuery = queryOptions({
  queryKey: ["last-sync"],
  queryFn: () => getLastSync(),
});

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(catalogQuery),
      context.queryClient.ensureQueryData(lastSyncQuery),
    ]);
  },
  component: DashboardPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen grid place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl mb-2">Gagal memuat data</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
});

function DashboardPage() {
  const { data: catalog } = useSuspenseQuery(catalogQuery);
  const { data: syncLog } = useSuspenseQuery(lastSyncQuery);

  const hasData = catalog.length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-4 md:p-8 selection:bg-brass-soft">
      <div className="max-w-7xl mx-auto">
        <DashboardHeader syncLog={syncLog} />
        {hasData ? (
          <DashboardBody catalog={catalog} />
        ) : (
          <EmptyState />
        )}
        <Footer />
      </div>
    </div>
  );
}

function DashboardHeader({ syncLog }: { syncLog: Awaited<ReturnType<typeof getLastSync>> }) {
  const lastRun = syncLog[0];
  const router = useRouter();
  const qc = useQueryClient();
  const trigger = useServerFn(triggerSync);
  const mutation = useMutation({
    mutationFn: () => trigger(),
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.invalidate();
    },
  });

  return (
    <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-paper-edge pb-8 animate-reveal">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="size-9 bg-emerald flex items-center justify-center rounded-sm">
            <span className="text-background font-display font-bold text-lg">A</span>
          </div>
          <h1 className="text-2xl font-display font-semibold tracking-tight">
            Aurum<span className="italic font-normal opacity-60">Insight</span>
          </h1>
        </div>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">
          Indeks Harga Emas Fisik Indonesia
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-mono uppercase text-muted-foreground">Sinkronisasi Terakhir</span>
          <span className="text-xs font-mono font-medium">
            {lastRun ? formatDateTimeID(lastRun.ran_at) : "Belum pernah"}
          </span>
        </div>
        <div className="h-8 w-px bg-paper-edge hidden md:block" />
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="px-4 py-2 text-xs font-semibold uppercase tracking-widest bg-emerald text-background rounded-sm hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {mutation.isPending ? "Menyinkronkan…" : "Sinkron sekarang"}
        </button>
      </div>
    </header>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-paper-edge rounded-lg p-16 text-center animate-reveal">
      <p className="font-display text-2xl mb-3">Belum ada data harga</p>
      <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
        Klik <span className="font-semibold">Sinkron sekarang</span> di kanan atas untuk mengambil harga terbaru dari 5 toko (Aneka Logam, Galeri24, Pegadaian, Logam Mulia, Hartadinata). Setelah itu, sinkronisasi harian berjalan otomatis pukul 10:00 WIB.
      </p>
    </div>
  );
}

function DashboardBody({ catalog }: { catalog: CatalogEntry[] }) {
  // Derive selectable sources / material / weight from catalog
  const sources = useMemo(
    () => Array.from(new Set(catalog.map((c) => c.source))).sort(),
    [catalog],
  );
  const [source, setSource] = useState(sources[0]);
  const materials = useMemo(
    () =>
      Array.from(new Set(catalog.filter((c) => c.source === source).map((c) => c.material_type))).sort(),
    [catalog, source],
  );
  const [materialType, setMaterialType] = useState<string>(materials[0] ?? "");
  const weights = useMemo(
    () =>
      Array.from(
        new Set(
          catalog
            .filter((c) => c.source === source && c.material_type === materialType)
            .map((c) => c.weight),
        ),
      ).sort((a, b) => a - b),
    [catalog, source, materialType],
  );
  const [weight, setWeight] = useState<number>(weights[0] ?? 1);
  const [days, setDays] = useState<7 | 30 | 90>(30);

  // Keep dependent state consistent when parent selectors change
  useMemo(() => {
    if (!materials.includes(materialType) && materials[0]) setMaterialType(materials[0]);
  }, [materials, materialType]);
  useMemo(() => {
    if (!weights.includes(weight) && weights[0]) setWeight(weights[0]);
  }, [weights, weight]);

  // History query lives here so both TodaySection (signal) and ChartSection share it
  const history = useQuery({
    queryKey: ["history", source, materialType, weight, days],
    queryFn: () => getHistory({ data: { source, materialType, weight, days } }),
    enabled: Boolean(source && materialType && weight),
  });
  const historyData = history.data ?? [];
  const signal = useMemo(() => computeSignal(historyData.map((h) => h.sell)), [historyData]);

  return (
    <main className="space-y-10">
      <FilterBar
        sources={sources}
        materials={materials}
        weights={weights}
        source={source}
        materialType={materialType}
        weight={weight}
        days={days}
        onSource={setSource}
        onMaterial={setMaterialType}
        onWeight={setWeight}
        onDays={setDays}
      />

      <Suspense fallback={<SectionSkeleton />}>
        <TodaySection weight={weight} source={source} materialType={materialType} signal={signal} />
      </Suspense>

      <ChartSection history={historyData} isLoading={history.isLoading}
        source={source} materialType={materialType} weight={weight} days={days} />
    </main>
  );
}

function FilterBar(props: {
  sources: string[];
  materials: string[];
  weights: number[];
  source: string;
  materialType: string;
  weight: number;
  days: 7 | 30 | 90;
  onSource: (v: string) => void;
  onMaterial: (v: string) => void;
  onWeight: (v: number) => void;
  onDays: (v: 7 | 30 | 90) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 animate-reveal">
      <SelectField label="Toko" value={props.source} onChange={props.onSource}
        options={props.sources.map((s) => ({ value: s, label: formatSourceName(s) }))} />
      <SelectField label="Brand" value={props.materialType} onChange={props.onMaterial}
        options={props.materials.map((m) => ({ value: m, label: m }))} />
      <SelectField label="Gramasi"
        value={String(props.weight)}
        onChange={(v) => props.onWeight(Number(v))}
        options={props.weights.map((w) => ({ value: String(w), label: `${w} gr` }))} />
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">Rentang</label>
        <div className="flex gap-1 bg-paper-edge/40 p-1 rounded-md">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => props.onDays(d as 7 | 30 | 90)}
              className={`flex-1 px-3 py-1.5 text-xs rounded transition-colors ${
                props.days === d
                  ? "bg-background font-semibold shadow-sm border border-paper-edge"
                  : "text-muted-foreground hover:text-foreground"
              }`}>
              {d}H
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-paper-edge rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brass"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function SectionSkeleton() {
  return <div className="h-40 rounded-lg border border-dashed border-paper-edge animate-pulse" />;
}

// -- Today section: KPI + comparison table + signal side card --

const todayQueryOptions = (weight: number) =>
  queryOptions({
    queryKey: ["today", weight],
    queryFn: () => getTodayPrices({ data: { weight } }),
  });

function TodaySection({ weight, source, materialType, signal }: {
  weight: number;
  source: string;
  materialType: string;
  signal: import("@/lib/signals").SignalResult;
}) {
  const { data } = useQuery(todayQueryOptions(weight));
  const latest = data?.latest ?? [];
  const previous = data?.previous ?? {};

  const currentRow = latest.find((r) => r.source === source && r.material_type === materialType);
  const currentPrev = currentRow ? previous[`${source}|${materialType}`] : undefined;

  const avgSell = latest.length ? latest.reduce((s, r) => s + Number(r.sell_price), 0) / latest.length : null;
  const avgBuy = latest.length ? latest.reduce((s, r) => s + Number(r.buyback_price), 0) / latest.length : null;
  const avgSpreadPct = latest.length
    ? (latest.reduce((s, r) => s + Number(r.spread) / Number(r.sell_price), 0) / latest.length) * 100
    : null;

  const sellDelta = formatDelta(
    currentRow ? Number(currentRow.sell_price) : null,
    currentPrev ? Number(currentPrev.sell_price) : null,
  );
  const buyDelta = formatDelta(
    currentRow ? Number(currentRow.buyback_price) : null,
    currentPrev ? Number(currentPrev.buyback_price) : null,
  );

  return (
    <>
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-reveal">
        <KpiCard
          label="Harga Jual"
          value={currentRow ? formatIDR(Number(currentRow.sell_price)) : formatIDR(avgSell)}
          hint={currentRow ? `${formatSourceName(source)} · ${materialType}` : "Rata-rata semua toko"}
          delta={sellDelta}
          accent
        />
        <KpiCard
          label="Buyback"
          value={currentRow ? formatIDR(Number(currentRow.buyback_price)) : formatIDR(avgBuy)}
          hint="IDR"
          delta={buyDelta}
        />
        <KpiCard
          label="Spread Margin"
          value={
            currentRow
              ? formatPct((Number(currentRow.spread) / Number(currentRow.sell_price)) * 100)
              : formatPct(avgSpreadPct)
          }
          hint="Jual vs Buyback"
        />
        <SignalCard signal={signal} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-reveal">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
              Perbandingan Antar-Toko · {weight} gr
            </h2>
            <span className="text-[10px] text-muted-foreground">Diurutkan: Spread terkecil</span>
          </div>
          <ComparisonTable rows={latest} activeKey={`${source}|${materialType}`} previous={previous} />
        </div>
        <AnalysisSidebar />
      </section>
    </>
  );
}

function KpiCard({
  label, value, hint, delta, accent,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: { text: string; direction: "up" | "down" | "flat" | "none" };
  accent?: boolean;
}) {
  const deltaColor =
    delta?.direction === "up" ? "text-emerald"
    : delta?.direction === "down" ? "text-rose-deep"
    : "text-muted-foreground";
  return (
    <div className="bg-card border border-paper-edge p-5 rounded-lg relative overflow-hidden">
      {accent && <div className="absolute top-0 left-0 w-1 h-full bg-brass" />}
      <span className="text-[10px] font-mono uppercase text-muted-foreground mb-4 block tracking-widest">{label}</span>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl md:text-3xl font-display font-bold tabular-nums">{value}</span>
        {delta && delta.direction !== "none" && (
          <span className={`text-xs font-mono ${deltaColor}`}>{delta.text}</span>
        )}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground mt-2 italic">{hint}</p>}
    </div>
  );
}

function SignalCard({ signal }: { signal: import("@/lib/signals").SignalResult }) {
  return (
    <div className="bg-emerald text-background p-5 rounded-lg shadow-lg relative overflow-hidden">
      <span className="text-[10px] font-mono uppercase opacity-70 mb-4 block tracking-widest">Status Sinyal</span>
      <div className="flex items-center gap-2 mb-1">
        <div className={`size-2 rounded-full bg-background ${signal.status === "insufficient" ? "opacity-40" : "animate-pulse"}`} />
        <span className="text-lg font-display font-bold tracking-tight">{signal.label}</span>
      </div>
      <p className="text-xs opacity-80 leading-relaxed">{signal.reason}</p>
    </div>
  );
}

function ComparisonTable({
  rows, activeKey, previous,
}: {
  rows: PriceRow[];
  activeKey: string;
  previous: Record<string, PriceRow>;
}) {
  const minSpread = rows.length ? Math.min(...rows.map((r) => Number(r.spread))) : 0;
  return (
    <div className="overflow-hidden border border-paper-edge rounded-lg bg-card">
      <table className="w-full text-left border-collapse">
        <thead className="bg-paper-edge/30 border-b border-paper-edge">
          <tr>
            <th className="p-4 text-[10px] font-mono uppercase text-muted-foreground tracking-widest">Toko / Brand</th>
            <th className="p-4 text-[10px] font-mono uppercase text-muted-foreground text-right tracking-widest">Jual</th>
            <th className="p-4 text-[10px] font-mono uppercase text-muted-foreground text-right tracking-widest">Buyback</th>
            <th className="p-4 text-[10px] font-mono uppercase text-muted-foreground text-right tracking-widest">Spread</th>
            <th className="p-4 text-[10px] font-mono uppercase text-muted-foreground text-right tracking-widest">Δ Jual</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-edge/50">
          {rows.map((r) => {
            const key = `${r.source}|${r.material_type}`;
            const isActive = key === activeKey;
            const isBest = Number(r.spread) === minSpread;
            const prev = previous[key];
            const delta = formatDelta(Number(r.sell_price), prev ? Number(prev.sell_price) : null);
            const spreadPct = (Number(r.spread) / Number(r.sell_price)) * 100;
            return (
              <tr key={key}
                className={`transition-colors ${isActive ? "bg-brass-soft" : "hover:bg-paper-edge/20"}`}>
                <td className="p-4 flex items-center gap-2 font-medium">
                  {isBest && <div className="size-2 bg-brass rounded-full" title="Spread terkecil" />}
                  <div>
                    <div>{formatSourceName(r.source)}</div>
                    <div className="text-[10px] text-muted-foreground">{r.material_type}</div>
                  </div>
                </td>
                <td className="p-4 text-right font-mono tabular-nums">{formatIDR(Number(r.sell_price))}</td>
                <td className="p-4 text-right font-mono tabular-nums text-muted-foreground">
                  {formatIDR(Number(r.buyback_price))}
                </td>
                <td className={`p-4 text-right font-mono tabular-nums ${isBest ? "font-bold text-emerald" : "text-muted-foreground"}`}>
                  {spreadPct.toFixed(2)}%
                </td>
                <td className={`p-4 text-right font-mono text-xs ${
                  delta.direction === "up" ? "text-emerald"
                  : delta.direction === "down" ? "text-rose-deep"
                  : "text-muted-foreground"
                }`}>
                  {delta.text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AnalysisSidebar() {
  return (
    <div className="space-y-6">
      <div className="bg-card border border-paper-edge p-6 rounded-lg">
        <h3 className="text-[10px] font-mono uppercase mb-4 pb-2 border-b border-paper-edge tracking-widest text-muted-foreground">
          Metodologi
        </h3>
        <ul className="space-y-3 text-xs text-muted-foreground leading-relaxed">
          <li><span className="font-semibold text-foreground">MA5 / MA20</span> — moving average harga jual, mendeteksi arah tren jangka pendek vs menengah.</li>
          <li><span className="font-semibold text-foreground">RSI 14</span> — momentum jenuh beli (&gt;70) / jenuh jual (&lt;30) atas harga jual.</li>
          <li><span className="font-semibold text-foreground">Spread</span> — selisih jual dan buyback. Semakin kecil, semakin efisien untuk churn.</li>
        </ul>
      </div>
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight px-2 leading-relaxed">
        Peringatan: Bukan nasihat keuangan. Sinyal berbasis aturan teknikal transparan dari data historis internal.
      </p>
    </div>
  );
}

// -- Chart section --

function ChartSection({
  history, isLoading, source, materialType, weight, days,
}: {
  history: Awaited<ReturnType<typeof getHistory>>;
  isLoading: boolean;
  source: string;
  materialType: string;
  weight: number;
  days: 7 | 30 | 90;
}) {
  const withMA = useMemo(() => {
    return history.map((h, i) => {
      const window5 = history.slice(Math.max(0, i - 4), i + 1).map((x) => x.sell);
      const window20 = history.slice(Math.max(0, i - 19), i + 1).map((x) => x.sell);
      const ma5 = window5.length === 5 ? window5.reduce((a, b) => a + b, 0) / 5 : null;
      const ma20 = window20.length === 20 ? window20.reduce((a, b) => a + b, 0) / 20 : null;
      return { ...h, ma5, ma20 };
    });
  }, [history]);

  return (
    <section className="animate-reveal">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
          Pergerakan Historis · {formatSourceName(source)} · {materialType} · {weight}gr · {days}H
        </h2>
        <div className="flex gap-4 text-[10px] font-mono uppercase">
          <span className="flex items-center gap-1.5"><div className="size-2 bg-emerald rounded-full" /> Jual</span>
          <span className="flex items-center gap-1.5"><div className="size-2 bg-brass rounded-full" /> Buyback</span>
          <span className="flex items-center gap-1.5"><div className="size-2 bg-foreground/40 rounded-full" /> MA20</span>
        </div>
      </div>

      <div className="w-full h-96 bg-card border border-paper-edge rounded-lg p-4">
        {isLoading ? (
          <div className="h-full grid place-items-center text-xs text-muted-foreground">Memuat…</div>
        ) : history.length === 0 ? (
          <div className="h-full grid place-items-center text-xs text-muted-foreground">
            Belum ada data historis untuk kombinasi ini.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={withMA} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="var(--color-paper-edge)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "var(--color-muted-foreground)" }}
                tickFormatter={(d) => formatDateID(d as string).replace(/ \d{4}$/, "")}
                stroke="var(--color-paper-edge)"
              />
              <YAxis
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "var(--color-muted-foreground)" }}
                tickFormatter={(v) => new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v as number)}
                stroke="var(--color-paper-edge)"
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-paper-edge)",
                  borderRadius: 6,
                  fontFamily: "JetBrains Mono",
                  fontSize: 11,
                }}
                labelFormatter={(l) => formatDateID(l as string)}
                formatter={(v: number, name) => [formatIDR(v), name]}
              />
              <Line type="monotone" dataKey="sell" name="Jual" stroke="var(--color-emerald)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="buyback" name="Buyback" stroke="var(--color-brass)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="ma20" name="MA20" stroke="var(--color-foreground)" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-16 pb-8 border-t border-paper-edge pt-6 flex flex-col md:flex-row gap-4 justify-between items-center">
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
        AurumInsight · Data internal · Bukan nasihat keuangan
      </span>
      <span className="text-[10px] font-mono text-muted-foreground">
        Sumber: logam-mulia-api (komunitas)
      </span>
    </footer>
  );
}
