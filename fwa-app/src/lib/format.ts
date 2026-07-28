import { formatUnits } from "viem";

export const BPS = 10_000n;

/** basis points -> percent string */
export function bpsToPct(bps: bigint, digits = 2): string {
  return (Number(bps) / 100).toFixed(digits) + "%";
}

export function fmt(value: bigint | undefined, decimals = 18, digits = 4): string {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function short(addr?: string): string {
  if (!addr) return "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export const DRAW_STATE = ["None", "Requested", "Fulfilled", "Settled", "Refunded"] as const;

/** milliseconds -> "23h 46m" / "46m 12s" / "12s" (seconds only under an hour) */
export function fmtDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s % 60}s`;
}
