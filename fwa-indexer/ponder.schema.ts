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
