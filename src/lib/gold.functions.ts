import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

function serverClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    },
  );
}

export type PriceRow = {
  source: string;
  material_type: string;
  weight: number;
  sell_price: number;
  buyback_price: number;
  spread: number;
  recorded_date: string;
};

export type CatalogEntry = {
  source: string;
  material_type: string;
  weight: number;
};

export const getCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const sb = serverClient();
  const { data, error } = await sb
    .from("gold_prices")
    .select("source, material_type, weight")
    .order("source")
    .limit(2000);
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const r of data ?? []) {
    const key = `${r.source}|${r.material_type}|${r.weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: r.source as string,
      material_type: r.material_type as string,
      weight: Number(r.weight),
    });
  }
  return out;
});

export const getTodayPrices = createServerFn({ method: "GET" })
  .inputValidator((d: { weight: number }) => z.object({ weight: z.number() }).parse(d))
  .handler(async ({ data }) => {
    const sb = serverClient();
    // latest recorded_date per source for the given weight
    const { data: rows, error } = await sb
      .from("gold_prices")
      .select("source, material_type, weight, sell_price, buyback_price, spread, recorded_date")
      .eq("weight", data.weight)
      .order("recorded_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const bySource = new Map<string, PriceRow>();
    for (const r of (rows ?? []) as unknown as PriceRow[]) {
      const key = `${r.source}|${r.material_type}`;
      if (!bySource.has(key)) bySource.set(key, r);
    }
    const latest = Array.from(bySource.values()).sort((a, b) => a.spread - b.spread);

    // Previous day (per source+material) for delta
    const prev = new Map<string, PriceRow>();
    for (const r of (rows ?? []) as unknown as PriceRow[]) {
      const key = `${r.source}|${r.material_type}`;
      const top = bySource.get(key);
      if (top && r.recorded_date < top.recorded_date && !prev.has(key)) {
        prev.set(key, r);
      }
    }

    return {
      latest,
      previous: Object.fromEntries(prev),
    };
  });

export const getHistory = createServerFn({ method: "GET" })
  .inputValidator((d: { source: string; materialType: string; weight: number; days: number }) =>
    z
      .object({
        source: z.string(),
        materialType: z.string(),
        weight: z.number(),
        days: z.number().int().positive().max(365),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sb = serverClient();
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - data.days);
    const { data: rows, error } = await sb
      .from("gold_prices")
      .select("recorded_date, sell_price, buyback_price, spread")
      .eq("source", data.source)
      .eq("material_type", data.materialType)
      .eq("weight", data.weight)
      .gte("recorded_date", since.toISOString().slice(0, 10))
      .order("recorded_date", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      date: r.recorded_date as string,
      sell: Number(r.sell_price),
      buyback: Number(r.buyback_price),
      spread: Number(r.spread),
    }));
  });

export const getLastSync = createServerFn({ method: "GET" }).handler(async () => {
  const sb = serverClient();
  const { data, error } = await sb
    .from("sync_runs")
    .select("ran_at, source, status, item_count, error_message")
    .order("ran_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const triggerSync = createServerFn({ method: "POST" }).handler(async () => {
  const { runSync } = await import("@/routes/api/public/hooks/sync-gold");
  const results = await runSync();
  return { ok: true, count: results.length, results };
});
