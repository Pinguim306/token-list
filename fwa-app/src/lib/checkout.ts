import { formatEther, parseEther } from "viem";
import { DEMO, demo } from "./demo";

/**
 * Hardcoded demo checkout ("marretado").
 *
 * While no pool contract is configured (demo mode), pack purchases are LIVE
 * anyway: the buy button sends a real native-HYPE transfer of the pack price to
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
 * Pack price in native HYPE. Flat product price per pack; a 20-pack purchase
 * (the per-tx cap) moves 4 HYPE.
 */
export const PACK_PRICE_HYPE = "0.2";
export const packPriceWei = parseEther(PACK_PRICE_HYPE);

/** How many packs one transaction may buy. */
export const MAX_PACKS_PER_TX = 20;

/** Total price for a quantity, in wei — exact bigint math, no float drift. */
export const totalPriceWei = (qty: number) => packPriceWei * BigInt(qty);

/** Total price for a quantity as a display string ("0.4"). */
export const totalPriceHype = (qty: number) => formatEther(totalPriceWei(qty));

export type DemoPosition = (typeof demo.positions)[number];

/**
 * Select winning positions the way FWAPool does: probability proportional to
 * each position's inverse-backing weight (the demo data pre-computes those as
 * oddsBps). Draws are WITHOUT replacement — on the contracts every drawn
 * position closes, so a multi-pack purchase is N sequential draws from a
 * shrinking pool. Client randomness stands in for the keeper × blockhash word.
 */
export function pickWeightedMany(count: number): DemoPosition[] {
  const pool = [...demo.positions];
  const winners: DemoPosition[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const total = pool.reduce((a, p) => a + Number(p.oddsBps), 0);
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      r -= Number(pool[j].oddsBps);
      if (r <= 0) {
        idx = j;
        break;
      }
    }
    winners.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return winners;
}
