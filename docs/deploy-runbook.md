# FWA deploy runbook — HyperEVM testnet beta

End-to-end steps to take the FWA stack from "all code merged, app in demo mode"
to "live on HyperEVM testnet, app off demo mode". Everything here is gated on
**one thing you must provide**: a funded deployer key (testnet HYPE). The rest
is mechanical.

> Scope: HyperEVM **testnet** (chainId `998`, network name `hyperevmTestnet`).
> Mainnet (`999`, `hyperevm`) is the same flow with the network swapped, gated
> on the Fase 4/5 checklist (external audit, multisig+timelock owner) — do not
> skip those for mainnet.

## HyperEVM-specific parameters (read first)

- **Dual-block architecture.** HyperEVM produces **small blocks (~1s, 3M gas)**
  and **big blocks (~60s, 30M gas)**, interleaved into one block-number
  sequence. **The larger contract deploys do not fit a small block**:
  `FWAFactory` is ~13.7 KB of runtime bytecode (~2.75M gas of code deposit),
  and its full deploy transaction — intrinsic gas + initcode calldata +
  constructor execution + deposit — lands just past the 3M small-block cap.
  Before deploying, switch the deployer to big blocks, then switch back
  afterwards so the keeper's reveals keep landing in 1s blocks. Run
  `npm run size` first: every contract must stay under the **24 KB EIP-170
  limit** (largest today is 56% of it).

  > **Big-block prerequisite — the deployer must be a Core user first.**
  > `evmUserModify` ("use big blocks") is a HyperCore action, and HyperCore and
  > HyperEVM are separate ledgers: an address holding HYPE only on the EVM side
  > cannot send it. Make the deployer a Core user by having it receive a Core
  > asset first (on testnet: the faucet at app.hyperliquid-testnet.xyz), then
  > toggle big blocks, then transfer HYPE to the EVM side for gas.
- **Keeper window ≈ 4 minutes.** 256 blocks at the ~1s small-block cadence is
  only **~4.3 min** of blockhash availability. The keeper bot must be running
  and prompt (its 5s poll is fine), and you **must** tune the pool with
  `setParams` so `requestTimeout` ≈ **10 min** instead of the 1 h default —
  otherwise a buyer waits an hour for a refund on a failure that was already
  terminal after four minutes.
- **Chainlink VRF does not exist on HyperEVM.** Chainlink ships data feeds
  there, not VRF, so `ADAPTER=vrf` is **refused by `deploy.js` on chains
  999/998** (it would wire the router to a backend that can never answer).
  `ADAPTER=keeper` is the launch path. The verifiable upgrade on this chain is
  **Pyth Entropy** (two-party commit-reveal, live on HyperEVM), implemented as
  `PythEntropyAdapter` behind the same router — one `setAdapter` swap, zero
  pool changes. To use it: resolve the chain's **Entropy contract + provider**
  from docs.pyth.network, verify both on the explorer, deploy with
  `ADAPTER=entropy ENTROPY_ADDRESS=0x… ENTROPY_PROVIDER=0x…` (or deploy the
  adapter standalone, `configure`, then `router.setAdapter`), and **prefund the
  adapter with HYPE** — it pays Entropy's per-request fee from its own balance
  and reverts loudly when underfunded. Before mainnet, swap the vendored
  `IEntropyLike` mirror for the official `entropy-sdk-solidity` interfaces.
- **The public RPC is not archival.** Hyperliquid prunes the `/evm` endpoints
  roughly every 12 hours (there is **no official `/nanoreth` path** on
  rpc.hyperliquid.xyz — it 404s). The indexer backfills from `START_BLOCK`, so
  point `PONDER_RPC_URL` at an archival endpoint: a provider such as QuickNode,
  Chainstack (whose endpoints expose a `/nanoreth` archive path), or a
  self-hosted `nanoreth` archive node — otherwise indexing breaks as soon as
  the deploy block ages out.
- **Pack contents**: the product is curated to **three tokenized stocks** —
  **Tesla (TSLAon)** and **NVIDIA (NVDAon)** from **Ondo** (bridged to HyperEVM
  over LayerZero as native OFTs), and **SpaceX (SPCXD)** from **Dinari** —
  allowlisted via `EquityBasket.setTokenAllowed`.

  > ⚠️ **Addresses are not recorded here on purpose.** The bStock addresses
  > this file used to carry were HyperEVM-only and do not exist on HyperEVM.
  > Before allowlisting, resolve each token's HyperEVM address from the
  > **issuer's own documentation** (Ondo, Dinari), then open it on
  > [hyperevmscan.io](https://hyperevmscan.io) and confirm the issuer and that
  > it is the official contract — a wrong or look-alike address would wrap an
  > unbacked token. Note that Dinari's SPCXD trades spot on **HyperCore**;
  > confirm it is linked as an ERC-20 on HyperEVM before wiring it into the
  > basket, since `EquityBasket` wraps ERC-20s, not HyperCore spot balances.
  > Curation is the owner's responsibility. (Testnet uses mocks; these addresses
  > gate mainnet.)
- **Dynamic pricing** is off by default; enable with
  `pool.setDynamicPricing(dispersionFactorBps, maxExtraSurchargeBps)` — e.g.
  `(5000, 2000)` = add 50% of the dispersion, capped at +20%.

---

## 0. Prerequisites (human)

- A deployer account with **testnet HYPE** on chain 998 (for gas). Export its
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
DEPLOYER_MNEMONIC="…" npx hardhat run scripts/deploy.js --network hyperevmTestnet
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

Both HyperEVM chains are supported by **Sourcify** (sourcify.dev), and mainnet
(999) additionally by the unified **Etherscan V2 API** (confirmed in
Etherscan's `/v2/chainlist`; testnet 998 is not covered by it).

```bash
# Testnet (998): Sourcify only — the env flag skips the Etherscan verifier,
# which cannot know chain 998:
SOURCIFY_ONLY=1 npx hardhat verify --network hyperevmTestnet <address> <constructor-args…>

# Mainnet (999): Etherscan V2 (set ETHERSCAN_API_KEY — a regular Etherscan
# key; the config's plain-string apiKey selects V2 mode) + Sourcify:
npx hardhat verify --network hyperevm <address> <constructor-args…>
```

Verify at least `pool`, `adapter`, `basket`, `vault`, `fwa`, `emitter`.

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
Mocks are fine for the testnet beta; the real Ondo/Dinari token addresses gate
mainnet — resolve them from the issuers and verify on the explorer per the
warning at the top of this runbook.

## 4. Start the keeper (required — draws don't resolve without it)

```bash
cd fwa-protocol
ADAPTER=<adapter> KEEPER_MASTER_SECRET=0x<32 bytes> DEPLOYER_MNEMONIC="<keeper's>" \
  FROM_BLOCK=<deploy block> \
  npx hardhat run scripts/keeper-bot.js --network hyperevmTestnet
```

And the replenisher (keeps the pool stocked from the vault, permissionless):

```bash
VAULT=<vault> npx hardhat run scripts/replenisher-bot.js --network hyperevmTestnet
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
| `NEXT_PUBLIC_CHAIN` | `testnet` (HyperEVM 998; `mainnet` = 999) |
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
  POOL=<pool> SAMPLES=20 npx hardhat run scripts/spike-randomness.js --network hyperevmTestnet
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
