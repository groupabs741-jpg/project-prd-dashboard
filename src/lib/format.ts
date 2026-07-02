const idr = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0,
});

export function formatIDR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return idr.format(Math.round(value));
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatDelta(curr: number | null, prev: number | null | undefined): {
  text: string;
  direction: "up" | "down" | "flat" | "none";
} {
  if (curr === null || prev === null || prev === undefined || prev === 0)
    return { text: "—", direction: "none" };
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  if (Math.abs(pct) < 0.01) return { text: "0.00%", direction: "flat" };
  const arrow = pct > 0 ? "▲" : "▼";
  return {
    text: `${arrow} ${Math.abs(pct).toFixed(2)}%`,
    direction: pct > 0 ? "up" : "down",
  };
}

export function formatSourceName(source: string): string {
  const map: Record<string, string> = {
    anekalogam: "Aneka Logam",
    galeri24: "Galeri24",
    pegadaian: "Pegadaian",
    logammulia: "Logam Mulia",
    hartadinataabadi: "Hartadinata Abadi",
  };
  return map[source] ?? source;
}

export function formatDateID(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTimeID(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }) + " WIB";
}
