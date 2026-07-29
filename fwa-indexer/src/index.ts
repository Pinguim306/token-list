import { ponder } from "ponder:registry";
import {
  position,
  draw,
  purchase,
  crownEvent,
  basket,
  basketEscrow,
  nftEscrow,
  randomnessRequest,
} from "ponder:schema";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const evId = (event: { transaction: { hash: string }; log: { logIndex: number } }) =>
  `${event.transaction.hash}-${event.log.logIndex}`;

// ---------------------------------------------------------------- positions
ponder.on("FWAPool:Deposited", async ({ event, context }) => {
  await context.db.insert(position).values({
    id: event.args.id,
    depositor: event.args.depositor,
    asset: event.args.asset,
    tokenId: event.args.tokenId,
    backing: event.args.backing,
    weight: event.args.weight,
    active: true,
    createdAt: event.block.timestamp,
    closedAt: null,
  });
});

ponder.on("FWAPool:Withdrawn", async ({ event, context }) => {
  await context.db
    .update(position, { id: event.args.id })
    .set({ active: false, closedAt: event.block.timestamp });
});

// ------------------------------------------------------------------- draws
ponder.on("FWAPool:DrawStarted", async ({ event, context }) => {
  await context.db.insert(draw).values({
    id: event.args.drawId,
    buyer: event.args.buyer,
    price: event.args.price,
    totalWeightSnapshot: event.args.totalWeightSnapshot,
    state: "Requested",
    randomWord: null,
    selectedId: null,
    choice: null,
    requestedAt: event.block.timestamp,
    resolvedAt: null,
  });
});

ponder.on("FWAPool:DrawFulfilled", async ({ event, context }) => {
  await context.db
    .update(draw, { id: event.args.drawId })
    .set({ state: "Fulfilled", randomWord: event.args.randomWord });
});

ponder.on("FWAPool:DrawSettled", async ({ event, context }) => {
  await context.db.update(draw, { id: event.args.drawId }).set({
    state: "Settled",
    selectedId: event.args.selectedId,
    choice: event.args.choice,
    resolvedAt: event.block.timestamp,
  });
  await context.db
    .update(position, { id: event.args.selectedId })
    .set({ active: false, closedAt: event.block.timestamp });
});

ponder.on("FWAPool:DrawRefunded", async ({ event, context }) => {
  await context.db
    .update(draw, { id: event.args.drawId })
    .set({ state: "Refunded", resolvedAt: event.block.timestamp });
});

// ------------------------------------------------------------------- crown
ponder.on("FWAPool:CrownClaimed", async ({ event, context }) => {
  await context.db.insert(crownEvent).values({
    id: evId(event),
    kind: "claimed",
    positionId: event.args.id,
    potPaid: null,
    at: event.block.timestamp,
  });
});

ponder.on("FWAPool:CrownDethroned", async ({ event, context }) => {
  await context.db.insert(crownEvent).values({
    id: evId(event),
    kind: "dethroned",
    positionId: event.args.newId,
    potPaid: event.args.potPaid,
    at: event.block.timestamp,
  });
});

ponder.on("FWAPool:CrownVacated", async ({ event, context }) => {
  await context.db.insert(crownEvent).values({
    id: evId(event),
    kind: "vacated",
    positionId: event.args.id,
    potPaid: event.args.potPaid,
    at: event.block.timestamp,
  });
});

// -------------------------------------------------------------- purchasers
ponder.on("FWAEmitter:PurchaseRecorded", async ({ event, context }) => {
  await context.db.insert(purchase).values({
    id: evId(event),
    buyer: event.args.buyer,
    day: event.args.day,
    at: event.block.timestamp,
  });
});

// ------------------------------------------------------- stuck NFT escrows
ponder.on("FWAPool:NFTEscrowed", async ({ event, context }) => {
  const id = `${event.args.asset}-${event.args.tokenId}`.toLowerCase();
  const values = {
    asset: event.args.asset,
    tokenId: event.args.tokenId,
    account: event.args.to,
    claimed: false,
    updatedAt: event.block.timestamp,
  };
  // The same NFT can re-escrow after a failed claim cycle — upsert, not insert.
  const existing = await context.db.find(nftEscrow, { id });
  if (existing) await context.db.update(nftEscrow, { id }).set(values);
  else await context.db.insert(nftEscrow).values({ id, ...values });
});

ponder.on("FWAPool:StuckNFTClaimed", async ({ event, context }) => {
  const id = `${event.args.asset}-${event.args.tokenId}`.toLowerCase();
  await context.db
    .update(nftEscrow, { id })
    .set({ claimed: true, updatedAt: event.block.timestamp });
});

// ---------------------------------------------------------- equity baskets
ponder.on("EquityBasket:Wrapped", async ({ event, context }) => {
  // Stringify amounts so bigints survive the JSON column without precision loss.
  const contents = event.args.tokens.map((token, i) => ({
    token,
    amount: event.args.amounts[i]!.toString(),
  }));
  await context.db.insert(basket).values({
    id: event.args.basketId,
    owner: event.args.owner,
    contents,
    wrapped: true,
    createdAt: event.block.timestamp,
    unwrappedAt: null,
  });
});

ponder.on("EquityBasket:Unwrapped", async ({ event, context }) => {
  await context.db
    .update(basket, { id: event.args.basketId })
    .set({ wrapped: false, unwrappedAt: event.block.timestamp });
});

// Keep basket ownership current as the ERC-721 moves (e.g. into the pool, then
// to the draw winner). Mint (from 0) is covered by Wrapped, burn (to 0) by
// Unwrapped — skip both so we never touch a not-yet/no-longer-existing row.
ponder.on("EquityBasket:Transfer", async ({ event, context }) => {
  if (event.args.from === ZERO_ADDR || event.args.to === ZERO_ADDR) return;
  await context.db.update(basket, { id: event.args.tokenId }).set({ owner: event.args.to });
});

ponder.on("EquityBasket:TokenEscrowed", async ({ event, context }) => {
  const id = `${event.args.token}-${event.args.to}`.toLowerCase();
  const existing = await context.db.find(basketEscrow, { id });
  if (existing) {
    await context.db
      .update(basketEscrow, { id })
      .set({ amount: existing.amount + event.args.amount, updatedAt: event.block.timestamp });
  } else {
    await context.db.insert(basketEscrow).values({
      id,
      token: event.args.token,
      account: event.args.to,
      amount: event.args.amount,
      updatedAt: event.block.timestamp,
    });
  }
});

ponder.on("EquityBasket:StuckTokenClaimed", async ({ event, context }) => {
  const id = `${event.args.token}-${event.args.account}`.toLowerCase();
  await context.db
    .update(basketEscrow, { id })
    .set({ amount: 0n, updatedAt: event.block.timestamp });
});

// -------------------------------------------------------- keeper randomness
ponder.on("KeeperHashChainAdapter:RandomnessRequested", async ({ event, context }) => {
  await context.db.insert(randomnessRequest).values({
    id: event.args.routerRequestId,
    seedBlock: event.args.seedBlock,
    status: "requested",
    randomWord: null,
    requestedAt: event.block.timestamp,
    resolvedAt: null,
  });
});

ponder.on("KeeperHashChainAdapter:Revealed", async ({ event, context }) => {
  await context.db.update(randomnessRequest, { id: event.args.routerRequestId }).set({
    status: "revealed",
    randomWord: event.args.randomWord,
    resolvedAt: event.block.timestamp,
  });
});

ponder.on("KeeperHashChainAdapter:StaleSkipped", async ({ event, context }) => {
  await context.db
    .update(randomnessRequest, { id: event.args.routerRequestId })
    .set({ status: "skipped", resolvedAt: event.block.timestamp });
});
