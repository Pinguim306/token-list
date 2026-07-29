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
  acquisitionCutBps: 2000n,
  topShareBps: 500n,
  settlementWindow: 86_400n, // 24 h purchaser-only decision window
  requestTimeout: 3_600n, // randomness liveness deadline
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

  /** Basket-unwrap payouts that could not be delivered (paused token) and sit
   *  in escrow awaiting claimStuckToken. */
  stuckPayouts: [
    { token: "0xE9010000000000000000000000000000000000b2", symbol: "rTSLA", amount: 4n * WAD, decimals: 18 },
  ],
  /** NFTs escrowed by the pool because settlement delivery reverted
   *  (pool.claimStuckNFT recovers them). */
  stuckNfts: [
    { asset: "0xC0113c7100000000000000000000000000000001", symbol: "FPUNK", tokenId: 77n },
  ],
  /** Pending $FWA emissions per owned position (emitter.pendingOf). */
  pendingEmissions: new Map<bigint, bigint>([
    [1n, 12n * WAD],
    [4n, 3n * WAD],
  ]),

  /** Keeper randomness adapter — live on-chain state (KeeperHashChainAdapter). */
  randomness: {
    seedDelay: 5n,
    blockhashWindow: 256n,
    chainHead: "0x9f2c7d5e41ab88603be4c0a1e6d3f70915a2b8c4d6e0f1234567890abcdef1122",
    revealsRemaining: 863n,
    pendingRequestId: 0n, // 0 = idle (no draw in flight)
    pendingSeedBlock: 0n,
    keeper: "0xKEEPER00000000000000000000000000000keeper",
    bond: 5n * WAD, // 5 ETH posted
    slashableSkips: 0n,
  },
  /** Recent randomness requests (indexer's randomnessRequest table). Fixed
   *  values keep the preview deterministic. status: requested|revealed|skipped. */
  randomnessFeed: [
    { id: 12n, seedBlock: 41_920_005n, status: "revealed", word: "0x7b4e…c1a9", requestedAt: 1784925000n, resolvedAt: 1784925042n },
    { id: 11n, seedBlock: 41_916_408n, status: "revealed", word: "0x2f80…44de", requestedAt: 1784921400n, resolvedAt: 1784921455n },
    { id: 10n, seedBlock: 41_912_810n, status: "revealed", word: "0xd311…9f02", requestedAt: 1784917800n, resolvedAt: 1784917861n },
    { id: 9n,  seedBlock: 41_909_212n, status: "skipped",  word: null,          requestedAt: 1784914200n, resolvedAt: 1784918100n },
    { id: 8n,  seedBlock: 41_905_614n, status: "revealed", word: "0x5a6c…07bb", requestedAt: 1784910600n, resolvedAt: 1784910648n },
  ],

  /** Sample allowlisted tokenized equities (EquityBasket wrap candidates).
   *  Round demo prices keep the derived USD values legible and test-stable. */
  equities: [
    { address: "0xE9010000000000000000000000000000000000a1", symbol: "rAAPL", name: "Tokenized Apple", priceUsd: 200 },
    { address: "0xE9010000000000000000000000000000000000b2", symbol: "rTSLA", name: "Tokenized Tesla", priceUsd: 300 },
    { address: "0xE9010000000000000000000000000000000000c3", symbol: "rNVDA", name: "Tokenized Nvidia", priceUsd: 100 },
  ],
  /** Sample baskets owned by the preview wallet. Amounts are 18-decimals. */
  baskets: [
    {
      id: 1n,
      contents: [
        { token: "0xE9010000000000000000000000000000000000a1", symbol: "rAAPL", amount: 10n * WAD, decimals: 18 },
        { token: "0xE9010000000000000000000000000000000000b2", symbol: "rTSLA", amount: 2n * WAD, decimals: 18 },
      ],
    },
    {
      id: 2n,
      contents: [
        { token: "0xE9010000000000000000000000000000000000c3", symbol: "rNVDA", amount: 5n * WAD, decimals: 18 },
      ],
    },
  ],
};
