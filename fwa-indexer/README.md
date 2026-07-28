# FWA Indexer (Ponder)

[Ponder](https://ponder.sh) indexer for the Fake World Assets pool + emitter on
RobinhoodChain testnet (chainId 46630). Serves a GraphQL API over the indexed
tables.

## Tables (`ponder.schema.ts`)
- **position** — depositor positions (backing, weight, active, created/closed).
- **draw** — acquisition draws and their lifecycle (Requested → Fulfilled → Settled/Refunded, selected id, choice).
- **purchase** — purchaser acquisitions bucketed by emissions day (feeds the daily-pot UI).
- **crownEvent** — crown claim / dethrone / vacate history.
- **basket** — equity baskets (contents JSON, owner tracked through transfers, wrapped flag).
- **basketEscrow** — unwrap payouts escrowed because a token was paused, pending `claimStuckToken`.
- **randomnessRequest** — keeper randomness per router request (requested → revealed | skipped, seed block, word) for latency/health views.

## Contracts (`ponder.config.ts`)
`FWAPool`, `FWAEmitter`, `EquityBasket`, `KeeperHashChainAdapter`. Each address
comes from an env var and defaults to the zero address — an unset contract is
simply not indexed, so an incomplete deployment never breaks the indexer.

## Run
```bash
npm install
cp .env.local.example .env.local   # set POOL/EMITTER/BASKET/ADAPTER_ADDRESS + START_BLOCK
npm run codegen                    # generate ponder-env.d.ts
npm run dev                        # index + GraphQL at http://localhost:42069
```

Point the addresses at the JSON that `fwa-protocol/scripts/deploy.js` prints,
set `START_BLOCK` to the deploy block, then point the app's
`NEXT_PUBLIC_INDEXER_URL` at this server. See `../docs/deploy-runbook.md` for the
full flow.

Ponder uses an embedded PGlite database by default — no external Postgres needed
for local development. ABIs in `abis/` are extracted from the `fwa-protocol`
artifacts. Handlers live in `src/index.ts`.
