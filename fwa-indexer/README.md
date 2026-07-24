# FWA Indexer (Ponder)

[Ponder](https://ponder.sh) indexer for the Fake World Assets pool + emitter on
RobinhoodChain testnet (chainId 46630). Serves a GraphQL API over the indexed
tables.

## Tables (`ponder.schema.ts`)
- **position** — depositor positions (backing, weight, active, created/closed).
- **draw** — acquisition draws and their lifecycle (Requested → Fulfilled → Settled/Refunded, selected id, choice).
- **purchase** — purchaser acquisitions bucketed by emissions day (feeds the daily-pot UI).
- **crownEvent** — crown claim / dethrone / vacate history.

## Run
```bash
npm install
cp .env.local.example .env.local   # set POOL_ADDRESS, EMITTER_ADDRESS, START_BLOCK
npm run codegen                    # generate ponder-env.d.ts
npm run dev                        # index + GraphQL at http://localhost:42069
```

Ponder uses an embedded PGlite database by default — no external Postgres needed
for local development. ABIs in `abis/` are extracted from the `fwa-protocol`
artifacts. Handlers live in `src/index.ts`.
