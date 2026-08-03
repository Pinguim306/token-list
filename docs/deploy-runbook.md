# FWA deploy runbook — BNB Chain testnet beta

End-to-end steps to take the FWA stack from "all code merged, app in demo mode"
to "live on BNB Chain testnet, app off demo mode". Everything here is gated on
**one thing you must provide**: a funded deployer key (tBNB from the BNB
faucet). The rest is mechanical.

> Scope: BSC **testnet** (chainId `97`, network name `bscTestnet`). Mainnet
> (`56`, `bsc`) is the same flow with the network swapped, gated on the Fase
> 4/5 checklist (external audit, multisig+timelock owner) — do not skip those
> for mainnet.

## BNB-specific parameters (read first)

- **Block time ~0.75s** → the keeper's 256-block blockhash window is only
  **~3.2 minutes**. The keeper bot must be running and prompt (its 5s poll is
  fine); tune the pool with `setParams` so `requestTimeout` ≈ 10–15 min instead
  of the 1 h default — buyers should not wait an hour for a refund.
- **Native Chainlink VRF** exists on BNB. `ADAPTER=vrf` deploys the
  `VRFDirectAdapter`; `configure()` it with the BNB coordinator/keyHash/subId
  and fund the subscription. Keeper remains the zero-dependency launch path;
  VRF is the verifiable upgrade (one `setAdapter` swap).
- **Pack contents**: the product is curated to **three tokenized stocks** —
  **Tesla (TSLAB)**, **NVIDIA (NVDAB)** and **SpaceX (SPCXB)** — allowlisted via
  `EquityBasket.setTokenAllowed`. Their **BNB Chain (BEP-20) mainnet** addresses,
  issued by BTech Holdings Limited (the bStocks issuer, a Binance affiliate):

  | Ticker | Stock | BNB Chain address |
  |---|---|---|
  | TSLAB | Tesla | `0x5b1910eaad6450e50f816082aa078c41f10c292f` |
  | NVDAB | NVIDIA | `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` |
  | SPCXB | SpaceX | `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1` |

  > ⚠️ **Verify each address on BscScan before allowlisting.** These were
  > sourced from third-party explorers (CoinGecko/BscScan), not a signed
  > on-chain manifest. For each one, open the address on BscScan and confirm the
  > issuer is **BTech Holdings Limited** and that it is the official contract —
  > a wrong or look-alike address would wrap an unbacked token. Curation is the
  > owner's responsibility. (Testnet uses mocks; these addresses gate mainnet.)
- **Dynamic pricing** is off by default; enable with
  `pool.setDynamicPricing(dispersionFactorBps, maxExtraSurchargeBps)` — e.g.
  `(5000, 2000)` = add 50% of the dispersion, capped at +20%.

---

## 0. Prerequisites (human)

- A deployer account with **tBNB** on chain 97 (for gas — BNB faucet). Export its
  mnemonic as `DEPLOYER_MNEMONIC` (see `fwa-protocol/.env.example`).
- A **keeper secret**: 32 random bytes, `0x`-prefixed, kept in a secret manager
  — never in the repo. This is the seed of the randomness hash chain; whoever
  holds it can predict preimages (see `audit/threat-model.md`).
  Generate one off-machine, e.g. `openssl rand -hex 32` → prefix with `0x`.
- Optional: a small ETH amount for the keeper account and, if you want it
  slashable, a keeper bond.

The deployer key is the only true blocker — until it exists, steps 1+ cannot run.

---

## 1. Deploy the stack

```bash
cd fwa-protocol
npm install && npm run build
DEPLOYER_MNEMONIC="…" npx hardhat run scripts/deploy.js --network bscTestnet
```

`ADAPTER=keeper` is the default launch randomness path; `ADAPTER=vrf` deploys
the Chainlink VRF v2.5 adapter instead. Pass
`KEEPER=0x…` to make a dedicated keeper account the adapter's keeper; otherwise
the deployer is the keeper. The script prints a JSON block — **save it**, every
later step reads from it:

```jsonc
{ "adapterKind": "keeper", "backing": "0x…", "whitelist": "0x…", "router": "0x…",
  "adapter": "0x…", "feeRouter": "0x…", "factory": "0x…", "pool": "0x…",
  "basket": "0x…", "vault": "0x…", "fwa": "0x…", "emitter": "0x…" }
```

Note the **deploy block number** (from any tx receipt / the explorer) — the
indexer's `START_BLOCK`.

## 2. Verify the contracts (optional but recommended)

```bash
npx hardhat verify --network bscTestnet <address> <constructor-args…>   # BSCSCAN_API_KEY env
```

BscScan is preconfigured in `hardhat.config.js` (set `BSCSCAN_API_KEY`). Verify
at least `pool`, `adapter`, `basket`, `vault`, `fwa`, `emitter`.

## 3. Curate assets (owner)

The pool ships with an **empty** collection whitelist and the basket with an
**empty** equity allowlist — deliberately. As the owner:

- **NFT collections** the pool will accept:
  `FWAWhitelist.setAllowed(collection, true)` for each vetted ERC-721.
- **Equity tokens** the basket may wrap:
  `EquityBasket.setTokenAllowed(token, true)` for each tokenized stock.
  (`deploy.js` already whitelisted the basket collection itself on the pool.)

Then seed the pool in bundles via the **PackVault**: fund it with stock tokens
+ backing, `setTemplate(tokens, amounts, backingPerPack)`,
`setPolicy(floor, bundleSize, cooldown)`, and `mintBundle(count)` for launch.
Mocks are fine for the testnet beta; the real bStocks token addresses (TSLAB,
NVDAB, SPCXB — see the address table under "BNB-specific parameters" above) gate
mainnet.

## 4. Start the keeper (required — draws don't resolve without it)

```bash
cd fwa-protocol
ADAPTER=<adapter> KEEPER_MASTER_SECRET=0x<32 bytes> DEPLOYER_MNEMONIC="<keeper's>" \
  FROM_BLOCK=<deploy block> \
  npx hardhat run scripts/keeper-bot.js --network bscTestnet
```

And the replenisher (keeps the pool stocked from the vault, permissionless):

```bash
VAULT=<vault> npx hardhat run scripts/replenisher-bot.js --network bscTestnet
```

The bot is stateless: on first tick it commits the epoch-0 hash-chain head, then
serves each draw (wait → reveal), auto-rotating chains and skipping stale seeds.
Run it under a process supervisor (systemd/pm2) so it restarts — it re-derives
its position from the chain on every start. Optionally post a slashable bond
from the keeper account via `KeeperHashChainAdapter.postBond{value: …}()`.

## 5. Run the indexer

```bash
cd fwa-indexer
npm install
cp .env.local.example .env.local
# set POOL_ADDRESS, EMITTER_ADDRESS, BASKET_ADDRESS, ADAPTER_ADDRESS, START_BLOCK
npm run codegen && npm run dev      # GraphQL at http://localhost:42069
```

For a hosted deployment (Railway/Render/Fly), point `PONDER_RPC_URL` at a
reliable RPC and use a real Postgres via `DATABASE_URL`. The GraphQL URL becomes
the app's `NEXT_PUBLIC_INDEXER_URL`.

## 6. Configure the frontend (leaves demo mode automatically)

The app is in demo mode **iff** `NEXT_PUBLIC_POOL_ADDRESS` is the zero address.
Set these (Vercel project env, or `.env.local` — see `fwa-app/.env.local.example`)
and redeploy:

| Var | From |
|---|---|
| `NEXT_PUBLIC_CHAIN` | `testnet` (BSC 97; `mainnet` = 56) |
| `NEXT_PUBLIC_POOL_ADDRESS` | deploy `pool` |
| `NEXT_PUBLIC_BACKING_TOKEN` | deploy `backing` |
| `NEXT_PUBLIC_NFT_COLLECTION` | a whitelisted collection (default deposit target) |
| `NEXT_PUBLIC_FWA_TOKEN` | deploy `fwa` |
| `NEXT_PUBLIC_EMITTER` | deploy `emitter` |
| `NEXT_PUBLIC_BASKET_ADDRESS` | deploy `basket` |
| `NEXT_PUBLIC_INDEXER_URL` | indexer GraphQL URL (optional; RPC fallback if unset) |
| `NEXT_PUBLIC_EQUITY_PRICES` | JSON map `{token: usdPrice}` for basket valuation (until a feed exists) |

`NEXT_PUBLIC_*` are inlined **at build time** — redeploy after changing them.

## 7. Smoke test

- Randomness round-trip + cost, the Fase 0 G0 measurement:
  ```bash
  cd fwa-protocol
  POOL=<pool> SAMPLES=20 npx hardhat run scripts/spike-randomness.js --network bscTestnet
  ```
  (Needs ≥1 active position, backing-token balance + approval, and the keeper bot
  running.) Writes a p50/p95 latency + per-draw cost report; fold it into
  `docs/fase0-findings.md` item #1.
- Manual: deposit an NFT + backing → `startDraw` → watch the keeper reveal → the
  app's sealed pack rips → settle Keep/SellBack. Confirm the indexer's `draw`
  and `randomnessRequest` rows update.

## 8. Ongoing operations

- **Keeper liveness** is the critical dependency. Alert on: keeper account ETH
  low, `StaleSkipped` emitted, `revealsRemaining` near zero, a draw stuck in
  `Requested` past the timeout.
- On a genuine keeper outage a draw refunds via `expireDraw`; answer the recorded
  `slashableSkips` with `slash(to, amount)` (or `slash(to, 0)` to forgive).
- Rotate the keeper with `setKeeper` only after the bond is withdrawn/slashed to
  zero.

---

## Blocked-on-key summary

Steps **1, 2, 4, 7** need the funded deployer/keeper key and cannot be done
autonomously in this environment. Steps **3, 5, 6** are configuration you drive
once the addresses exist. Everything the code side requires — contracts, keeper
bot, indexer handlers, app env plumbing — is already merged and tested.
