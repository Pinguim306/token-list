import { parseEther } from "viem";
import { DEMO, demo } from "./demo";

/**
 * Hardcoded demo checkout ("marretado").
 *
 * While no pool contract is configured (demo mode), pack purchases are LIVE
 * anyway: the buy button sends a real native-BNB transfer of the pack price to
 * the FWA treasury below, and the draw + settlement that follow are simulated
 * client-side to mirror exactly what the contracts will do (weighted random
 * selection, keep / sell-back at 85% of backing). One real transaction, zero
 * contract dependencies — the full purchase UX can be demoed end-to-end.
 *
 * When NEXT_PUBLIC_POOL_ADDRESS is set this module goes dormant and the real
 * startDraw/settle flow takes over unchanged.
 */
export const CHECKOUT = DEMO;

/** Demo treasury — every pack purchase transfers the pack price here. */
export const TREASURY = "0x8Ee4961c5E6F0C5325646F6775f20Cb694b8be14" as const;

/**
 * Pack price in native BNB. Derived from the demo pool price (132.5 units) at
 * a deliberately small scale — 0.0001 BNB per unit — so demo purchases move
 * real but small value: 132.5 × 0.0001 = 0.01325 BNB.
 */
export const PACK_PRICE_BNB = "0.01325";
export const packPriceWei = parseEther(PACK_PRICE_BNB);

export type DemoPosition = (typeof demo.positions)[number];

/**
 * Select the winning position the way FWAPool does: probability proportional
 * to each position's inverse-backing weight (the demo data pre-computes those
 * as oddsBps). Client randomness stands in for the keeper × blockhash word.
 */
export function pickWeighted(): DemoPosition {
  const total = demo.positions.reduce((a, p) => a + Number(p.oddsBps), 0);
  let r = Math.random() * total;
  for (const p of demo.positions) {
    r -= Number(p.oddsBps);
    if (r <= 0) return p;
  }
  return demo.positions[demo.positions.length - 1];
}
