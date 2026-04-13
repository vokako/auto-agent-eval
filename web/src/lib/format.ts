export function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

export function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${bytes}B`;
}

export function rateClass(rate: number): string {
  return rate >= 50 ? "green" : rate >= 30 ? "yellow" : "red";
}
