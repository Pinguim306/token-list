import { addresses } from "./contracts";

const WAD = 10n ** 18n;

/** Preview mode: on when no real pool address is configured. Panels then render
 *  representative sample data so the UI can be viewed without a live deployment. */
export const DEMO = addresses.pool === "0x0000000000000000000000000000000000000000";

export const demo = {
  decimals: 18,
  price: (1325n * WAD) / 10n, // 132.5
  activeCount: 5n,
  surchargeBps: 1000n,
  bidBps: 8500n,
  topListingId: 3n,
  topPot: (124n * WAD) / 10n, // 12.4
  drawInFlight: false,
  /** Sample whitelisted collections. The pool is collection-agnostic — positions
   *  carry the asset address — so the preview shows more than one on purpose. */
  collections: [
    { address: "0xC0113c7100000000000000000000000000000001", name: "Fake Punks", symbol: "FPUNK" },
    { address: "0xC0113c7100000000000000000000000000000002", name: "Fake Apes", symbol: "FAPE" },
  ],
  positions: [
    { id: 1n, depositor: "0xA11ce00000000000000000000000000000000b0b", asset: "0xC0113c7100000000000000000000000000000001", tokenId: 4242n, backing: 30n * WAD, oddsBps: 5200n },
    { id: 2n, depositor: "0xB0b0000000000000000000000000000000000c1d", asset: "0xC0113c7100000000000000000000000000000001", tokenId: 128n, backing: 75n * WAD, oddsBps: 2100n },
    { id: 3n, depositor: "0xCar01000000000000000000000000000000000e2f", asset: "0xC0113c7100000000000000000000000000000002", tokenId: 7n, backing: 400n * WAD, oddsBps: 400n },
    { id: 4n, depositor: "0xD1d1000000000000000000000000000000000f30", asset: "0xC0113c7100000000000000000000000000000001", tokenId: 999n, backing: 60n * WAD, oddsBps: 2600n },
    { id: 5n, depositor: "0xE2e2000000000000000000000000000000000041", asset: "0xC0113c7100000000000000000000000000000002", tokenId: 314n, backing: 210n * WAD, oddsBps: 700n },
  ],
  draw: {
    state: 2, // Fulfilled
    buyer: "0xB0b0000000000000000000000000000000000c1d",
    price: (1325n * WAD) / 10n,
    selectedId: 4n,
    drawId: 12n,
  },
  /** Settled/refunded history behind the current draw. Fixed timestamps keep the
   *  preview deterministic. state: 2=Fulfilled, 3=Settled, 4=Refunded. */
  drawHistory: [
    { id: 12n, buyer: "0xB0b0000000000000000000000000000000000c1d", price: (1325n * WAD) / 10n, selectedId: 4n, state: 2, requestedAt: 1784925000n, fulfilledAt: 1784925042n },
    { id: 11n, buyer: "0xA11ce00000000000000000000000000000000b0b", price: (1280n * WAD) / 10n, selectedId: 2n, state: 3, requestedAt: 1784921400n, fulfilledAt: 1784921455n },
    { id: 10n, buyer: "0xE2e2000000000000000000000000000000000041", price: (1312n * WAD) / 10n, selectedId: 5n, state: 3, requestedAt: 1784917800n, fulfilledAt: 1784917861n },
    { id: 9n,  buyer: "0xD1d1000000000000000000000000000000000f30", price: (1295n * WAD) / 10n, selectedId: 0n, state: 4, requestedAt: 1784914200n, fulfilledAt: 0n },
    { id: 8n,  buyer: "0xCar01000000000000000000000000000000000e2f", price: (1260n * WAD) / 10n, selectedId: 1n, state: 3, requestedAt: 1784910600n, fulfilledAt: 1784910648n },
  ],

  credit: (871n * WAD) / 10n, // 87.1
  reward: 250n * WAD,
  currentDay: 3n,
  purchaserBudget: 4500n * WAD,
};
