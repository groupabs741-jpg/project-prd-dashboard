import { createFileRoute } from "@tanstack/react-router";

const SOURCES = [
  "anekalogam",
  "galeri24",
  "pegadaian",
  "logammulia",
  "hartadinataabadi",
] as const;

const API_BASE = "https://logam-mulia-api.iamutaki.workers.dev";

type ApiItem = {
  source: string;
  material?: string;
  materialType?: string;
  weight?: number | string;
  weightUnit?: string;
  sellPrice?: number | string | null;
  buybackPrice?: number | string | null;
  currency?: string;
  recordedDate?: string;
};

type ApiResponse = { data?: ApiItem[] };

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function todayIsoWib(): string {
  // Convert current UTC to Asia/Jakarta (WIB, UTC+7) date
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

async function syncSource(source: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const url = `${API_BASE}/api/prices/${source}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${source}`);
  const json = (await res.json()) as ApiResponse | ApiItem[];
  const items = Array.isArray(json) ? json : (json.data ?? []);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Empty response from ${source}`);
  }

  const today = todayIsoWib();
  const rows: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const weight = toNumber(item.weight);
    const sell = toNumber(item.sellPrice);
    const buy = toNumber(item.buybackPrice);
    const materialType = (item.materialType ?? "").toString().trim();
    if (!weight || !sell || !buy || !materialType) continue;
    rows.push({
      source,
      material_type: materialType,
      weight,
      sell_price: sell,
      buyback_price: buy,
      recorded_date: item.recordedDate ?? today,
    });
  }

  if (rows.length === 0) throw new Error(`No valid rows parsed from ${source}`);

  const { error } = await supabaseAdmin
    .from("gold_prices")
    .upsert(rows, {
      onConflict: "source,material_type,weight,recorded_date",
      ignoreDuplicates: false,
    });
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("sync_runs").insert({
    source,
    status: "success",
    item_count: rows.length,
  });

  return rows.length;
}

async function runSync() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const results: Array<{ source: string; status: string; count?: number; error?: string }> = [];

  for (const source of SOURCES) {
    try {
      const count = await syncSource(source);
      results.push({ source, status: "success", count });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ source, status: "error", error: message });
      await supabaseAdmin.from("sync_runs").insert({
        source,
        status: "error",
        item_count: 0,
        error_message: message,
      });
    }
    // small delay to be polite
    await new Promise((r) => setTimeout(r, 400));
  }

  return results;
}

export const Route = createFileRoute("/api/public/hooks/sync-gold")({
  server: {
    handlers: {
      POST: async () => {
        const results = await runSync();
        return new Response(JSON.stringify({ ok: true, results }), {
          headers: { "content-type": "application/json" },
        });
      },
      GET: async () => {
        const results = await runSync();
        return new Response(JSON.stringify({ ok: true, results }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
