import { formatUnits } from "viem";
import { DEMO, demo } from "./demo";

/**
 * USD prices for wrappable equity tokens. There is no on-chain price feed
 * confirmed for this chain yet, so the source is deliberately swappable:
 * demo mode prices come from the sample data, live mode reads an optional
 * NEXT_PUBLIC_EQUITY_PRICES env var — a JSON map of token address to USD
 * price per whole token, e.g. '{"0xabc…":"197.29"}'. When the indexer grows
 * a price feed this module is the only place that changes.
 */
function loadMap(): Record<string, number> {
  if (DEMO) {
    return Object.fromEntries(demo.equities.map((e) => [e.address.toLowerCase(), e.priceUsd]));
  }
  // Static property access — Next only inlines the literal form (never index
  // process.env dynamically; the server bundle would miss the value).
  const raw = process.env.NEXT_PUBLIC_EQUITY_PRICES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, number | string>;
    const entries: [string, number][] = [];
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) entries.push([k.toLowerCase(), n]);
    }
    return Object.fromEntries(entries);
  } catch {
    return {}; // a malformed map disables valuation, never crashes a page
  }
}

const PRICES = loadMap();

/** USD price per whole token, or null when unpriced. */
export function equityPriceUsd(token: string): number | null {
  return PRICES[token.toLowerCase()] ?? null;
}

/** USD value of a raw token amount, or null when the token is unpriced. */
export function usdValue(token: string, amount: bigint, decimals: number): number | null {
  const p = equityPriceUsd(token);
  if (p === null) return null;
  return Number(formatUnits(amount, decimals)) * p;
}

export function fmtUsd(v: number | null): string {
  if (v === null) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
