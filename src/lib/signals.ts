export type SignalStatus = "insufficient" | "buy" | "sell" | "neutral";

export type SignalResult = {
  status: SignalStatus;
  label: string;
  reason: string;
  rsi: number | null;
  ma5: number | null;
  ma20: number | null;
  dataPoints: number;
};

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

// Wilder's RSI on a series (chronological, oldest -> newest)
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeSignal(sellSeries: number[]): SignalResult {
  const n = sellSeries.length;
  if (n < 20) {
    return {
      status: "insufficient",
      label: "Mengumpulkan data",
      reason: `Sinyal aktif setelah 20 hari data (progress ${n}/20).`,
      rsi: null,
      ma5: null,
      ma20: null,
      dataPoints: n,
    };
  }
  const ma5 = sma(sellSeries, 5);
  const ma20 = sma(sellSeries, 20);
  const r = rsi(sellSeries, 14);

  let status: SignalStatus = "neutral";
  let label = "Netral";
  const reasons: string[] = [];

  const rsiStr = r !== null ? r.toFixed(1) : "-";
  const maRel =
    ma5 !== null && ma20 !== null
      ? ma5 < ma20
        ? "MA5 di bawah MA20"
        : ma5 > ma20
          ? "MA5 di atas MA20"
          : "MA5 sejajar MA20"
      : null;

  if (r !== null && ma5 !== null && ma20 !== null) {
    if (r < 30 && ma5 < ma20) {
      status = "buy";
      label = "Indikasi Beli";
      reasons.push(`RSI ${rsiStr} (jenuh jual)`);
      if (maRel) reasons.push(maRel);
    } else if (r > 70 && ma5 > ma20) {
      status = "sell";
      label = "Indikasi Jual";
      reasons.push(`RSI ${rsiStr} (jenuh beli)`);
      if (maRel) reasons.push(maRel);
    } else {
      status = "neutral";
      label = "Netral";
      reasons.push(`RSI ${rsiStr}`);
      if (maRel) reasons.push(maRel);
    }
  }

  return {
    status,
    label,
    reason: reasons.join(", ") + ".",
    rsi: r,
    ma5,
    ma20,
    dataPoints: n,
  };
}
