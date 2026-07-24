import { ponder } from "ponder:registry";
import { position, draw, purchase, crownEvent } from "ponder:schema";

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
