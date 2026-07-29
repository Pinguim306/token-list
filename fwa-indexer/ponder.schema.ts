import { onchainTable } from "ponder";

/** One depositor position (id == pool position id / Fenwick leaf). */
export const position = onchainTable("position", (t) => ({
  id: t.bigint().primaryKey(),
  depositor: t.hex().notNull(),
  asset: t.hex().notNull(),
  tokenId: t.bigint().notNull(),
  backing: t.bigint().notNull(),
  weight: t.bigint().notNull(),
  active: t.boolean().notNull(),
  createdAt: t.bigint().notNull(),
  closedAt: t.bigint(),
}));

/** One acquisition draw and its lifecycle. */
export const draw = onchainTable("draw", (t) => ({
  id: t.bigint().primaryKey(),
  buyer: t.hex().notNull(),
  price: t.bigint().notNull(),
  totalWeightSnapshot: t.bigint().notNull(),
  state: t.text().notNull(), // Requested | Fulfilled | Settled | Refunded
  randomWord: t.bigint(),
  selectedId: t.bigint(),
  choice: t.integer(), // 0 = Keep, 1 = SellBack
  requestedAt: t.bigint().notNull(),
  resolvedAt: t.bigint(),
}));

/** One purchaser acquisition recorded against an emissions day. */
export const purchase = onchainTable("purchase", (t) => ({
  id: t.text().primaryKey(), // `${txHash}-${logIndex}`
  buyer: t.hex().notNull(),
  day: t.bigint().notNull(),
  at: t.bigint().notNull(),
}));

/** Crown claim / dethrone / vacate events. */
export const crownEvent = onchainTable("crown_event", (t) => ({
  id: t.text().primaryKey(), // `${txHash}-${logIndex}`
  kind: t.text().notNull(), // claimed | dethroned | vacated
  positionId: t.bigint(),
  potPaid: t.bigint(),
  at: t.bigint().notNull(),
}));

/** One equity basket (ERC-721 wrapping tokenized equities). `contents` is a
 *  JSON array of {token, amount} strings — amounts are stringified so bigint
 *  values survive the column without precision loss. */
export const basket = onchainTable("basket", (t) => ({
  id: t.bigint().primaryKey(),
  owner: t.hex().notNull(),
  contents: t.json().notNull(),
  wrapped: t.boolean().notNull(), // false once unwrapped/burned
  createdAt: t.bigint().notNull(),
  unwrappedAt: t.bigint(),
}));

/** A basket-unwrap payout that could not be delivered (paused token) and was
 *  escrowed for a later `claimStuckToken`. Cleared when claimed. */
export const basketEscrow = onchainTable("basket_escrow", (t) => ({
  id: t.text().primaryKey(), // `${token}-${account}`
  token: t.hex().notNull(),
  account: t.hex().notNull(),
  amount: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));

/** An NFT the pool escrowed because settlement delivery reverted, awaiting
 *  `claimStuckNFT` by its rightful recipient. `claimed` flips on recovery. */
export const nftEscrow = onchainTable("nft_escrow", (t) => ({
  id: t.text().primaryKey(), // `${asset}-${tokenId}`
  asset: t.hex().notNull(),
  tokenId: t.bigint().notNull(),
  account: t.hex().notNull(),
  claimed: t.boolean().notNull(),
  updatedAt: t.bigint().notNull(),
}));

/** Keeper randomness lifecycle per router request id: request -> reveal, or a
 *  permissionless stale skip. Lets the app show randomness latency/health
 *  without the app itself watching the adapter. */
export const randomnessRequest = onchainTable("randomness_request", (t) => ({
  id: t.bigint().primaryKey(), // routerRequestId
  seedBlock: t.bigint().notNull(),
  status: t.text().notNull(), // requested | revealed | skipped
  randomWord: t.bigint(),
  requestedAt: t.bigint().notNull(),
  resolvedAt: t.bigint(),
}));
