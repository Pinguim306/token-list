"use client";

import { fmt, bpsToPct, BPS } from "@/lib/format";

export type HealthZone = "over" | "balanced" | "under";

/**
 * The backing rule, encoded: the standing bid (bidBps × backing) is a buy-back
 * offer funded with the depositor's own money, and the drawer always takes
 * whichever side favors them. So:
 *
 *   bid > value            -> "over": sell-back trap — the drawer returns the
 *                             item and pockets a bid above what it's worth.
 *   backing < value        -> "under": the drawer keeps the item and the
 *                             depositor's exit (their backing back) is below
 *                             market.
 *   value <= backing <= value/bidRatio -> balanced: the drawer keeps, and the
 *                             exit lands at market or better.
 */
export function zoneFor(backing: bigint, value: bigint, bidBps: bigint): HealthZone {
  const bid = (backing * bidBps) / BPS;
  if (bid > value) return "over";
  if (backing < value) return "under";
  return "balanced";
}

export function BackingHealth({
  backing,
  value,
  bidBps,
  decimals,
}: {
  backing: bigint;
  value: bigint;
  bidBps: bigint;
  decimals: number;
}) {
  const zone = zoneFor(backing, value, bidBps);
  const bid = (backing * bidBps) / BPS;
  const min = value; // healthy floor: backing = your value estimate
  const max = (value * BPS) / bidBps; // healthy ceiling: bid = your value estimate
  const span = max - min > 0n ? max - min : 1n;

  // Piecewise marker so the healthy band gets real visual width:
  // under [0,33) · healthy [33,67) · over [67,100].
  let pct: number;
  if (backing < min) {
    pct = Number((backing * 33n) / min);
  } else if (backing <= max) {
    pct = 33 + Number(((backing - min) * 34n) / span);
  } else {
    pct = 67 + Math.min(33, Number(((backing - max) * 33n) / max));
  }

  const message =
    zone === "over"
      ? `Sell-back trap: the standing bid (${fmt(bid, decimals)}) is above your value estimate. ` +
        `Whoever draws this returns the item and pockets the bid — you would be out ` +
        `${fmt(backing - value, decimals)} versus simply holding. Healthy backing for this value: ` +
        `${fmt(min, decimals)} – ${fmt(max, decimals)}.`
      : zone === "under"
        ? `Below-market exit: when drawn, the winner keeps the item and your exit is only your ` +
          `backing — you would hand over ${fmt(value, decimals)} of value for ${fmt(backing, decimals)}. ` +
          `Raise the backing toward ${fmt(min, decimals)} – ${fmt(max, decimals)}.`
        : `Healthy: the bid (${fmt(bid, decimals)}, ${bpsToPct(bidBps)}) sits below your estimate, so the ` +
          `winner keeps the item and your exit ≈ market. Range for this value: ${fmt(min, decimals)} – ` +
          `${fmt(max, decimals)}.`;

  return (
    <div className="backing-meter" data-health-zone={zone}>
      <div className="bm-track" aria-hidden="true">
        <i className="bm-seg under" />
        <i className="bm-seg ok" />
        <i className="bm-seg trap" />
        <span className="bm-marker" style={{ left: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <div className="bm-labels" aria-hidden="true">
        <span>too low</span>
        <span>healthy</span>
        <span>sell-back trap</span>
      </div>
      <p className={`backing-note ${zone}`} role="status">
        {message}
      </p>
    </div>
  );
}
