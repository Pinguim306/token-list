# Fake World Assets (FWA) — Stock Packs on BNB Chain

An on-chain, randomized pack-ripping protocol for **BNB Chain** (BSC mainnet
`56` / testnet `97`), rebuilt from the FWA idea
([fwa.fun](https://www.fwa.fun/docs/overview)) with the product focused on
**packs of tokenized stocks** (TSLA, NVDA, private-market names, …).

Builders wrap tokenized stocks into an ERC-721 **pack** (EquityBasket) and list
it with an ERC-20 backing stake. Purchasers pay a pool-derived price to rip
**one pack at random**, then keep the stocks inside or sell the pack back for
the standing bid. Selection weight is **inversely proportional to backing**, so
lightly-backed packs are drawn often (small expected reward) and heavily-backed
ones are rare. The pool itself stays collection-agnostic — any whitelisted
ERC-721 still works; the stock-pack focus is curation, not a contract
constraint.

> Originally built for RobinhoodChain (configs kept for portability); the BNB
> pivot brings a multi-validator chain, native Chainlink VRF, and on-chain
> tokenized stocks (xStocks et al) for pack contents.

> This repository is the engineering counterpart to the viability study in
> [`../docs/analise-fwa-robinhoodchain.md`](../docs/analise-fwa-robinhoodchain.md).
> It implements **Fase 0 tooling + the core of Fase 1 (pool/randomness/selection)
> + Fase 2 (`$FWA` tokenomics: emissions, claim)** of that plan, all reviewed by an
> adversarial security pass whose confirmed findings are fixed in-tree.

## Why this is a redesign, not a port

RobinhoodChain lacks two pillars the original FWA relies on:

1. **No Chainlink VRF on-chain.** Randomness is abstracted behind a
   `RandomnessRouter` + swappable adapter. The **launch path** is the
   `KeeperHashChainAdapter`: a keeper commit-reveal hash chain mixed with a
   future blockhash — the same oracle-free scheme StockRip runs in production on
   Robinhood Chain, needing nothing but a funded keeper. **Chainlink VRF v2.5
   over CCIP** (`CCIPVRFAdapter`) remains the stronger-trust upgrade, swappable
   at the router with zero pool changes; a `MockRandomnessAdapter` drives the
   flow deterministically in tests.
2. **No blue-chip NFTs / ERC-721 bridge.** The core is **collection-agnostic and
   backing-token-agnostic** (any whitelisted ERC-721, backed by any ERC-20 such as
   USDG), so the prize layer can pivot without touching pool accounting. The
   `EquityBasket` wrapper extends the prize layer to **fungible tokenized
   equities** (Robinhood tokenized stocks): shares wrap into an ERC-721 basket
   that the pool treats like any whitelisted collection, and the draw winner
   unwraps back into the underlying tokens.

## Security model — the lesson of the 2026-07-03 FWA exploit

The live FWA protocol was drained when state was mutated **between the VRF request
and its callback**, steering a draw onto the pool's most valuable NFT. This
implementation is built around **freeze-at-request**:

- On `startDraw` the payment is escrowed and the **total selection weight is
  snapshotted**. Draws are **strictly serialized** (one in flight at a time) and
  the pool is **frozen** — no deposit or withdrawal can change the selection set
  while a draw is pending.
- The randomness callback (`fulfillRandomness`) is **minimal and resilient**: it
  only stores the word, never selects, never transfers, and **never reverts** on a
  stale/expired draw.
- Selection + settlement happen in a **separate, permissionless `settle` step**
  applied to the frozen snapshot. Payouts are **pull-based** (`withdrawCredit`).
- Liveness: if randomness never arrives, `expireDraw` refunds the buyer after a
  timeout; after the purchaser window, anyone can `finalize` the default outcome.

Serialized freeze is deliberately conservative for the MVP; higher throughput
(append-only deposits during flight, per-draw tree snapshots) is documented future
work.

## Contracts

| Contract | Responsibility |
|---|---|
| `core/FWAPool.sol` | Positions, inverse-weight selection, harmonic-mean pricing + surcharge, freeze-at-request draw queue, Keep/SellBack settlement, pull-based credits |
| `core/FWAFactory.sol` | Deploys & registers pools (collection-agnostic) |
| `core/FWAWhitelist.sol` | Curates allowed ERC-721 collections; sticky blocking |
| `core/FeeRouter.sol` | Splits protocol fees across recipients by basis-point shares |
| `libraries/FenwickTree.sol` | O(log n) weighted random selection (fixed capacity for correct dynamic growth) |
| `randomness/RandomnessRouter.sol` | Consumer ⇄ adapter indirection; minimal fulfill callback |
| `randomness/KeeperHashChainAdapter.sol` | **Launch randomness**: keeper commit-reveal hash chain × future blockhash (StockRip-parity), one serialized request, permissionless stale-skip, slashable keeper bond |
| `randomness/VRFDirectAdapter.sol` | **VRF upgrade path on BNB**: Chainlink VRF v2.5, direct subscription consumer (no CCIP hop); skeleton wired to the router |
| `randomness/MockRandomnessAdapter.sol` | Deterministic randomness for tests / local |
| `randomness/CCIPVRFAdapter.sol` | Production skeleton: VRF v2.5 request from Arbitrum One over CCIP (RH Chain side) |
| `randomness/VRFRequester.sol` | Production skeleton: Arbitrum One counterpart — draws VRF, relays back over CCIP |
| `token/FWAToken.sol` | `$FWA` reward token: capped, role-gated mint, launch gate, 1% DEX-trade fee |
| `token/FWAEmitter.sol` | `$FWA` emissions (MasterChef-style): depositor rewards on √backing + pro-rata daily-pot purchaser rewards; guarded pool hooks |
| `token/FWAClaim.sol` | Merkle-gated `$FWA` distribution (snapshot allocation) |
| `periphery/PackVault.sol` | Operator pack factory: bundle seeding (`mintBundle`) + permissionless pool replenishment (`replenishIfNeeded` with floor/bundle/cooldown policy) from a funded inventory |
| `basket/EquityBasket.sol` | Wraps allowlisted fungible tokenized equities into an ERC-721 basket (internal ledger, balance-delta deposits, burn-before-payout unwrap) so they enter the pool unchanged |
| `mocks/*` | ERC-20/721 + pausable-721 + reverting-emitter + Fenwick + reentrancy + randomness-consumer harnesses (test-only) |

The pool notifies the emitter via **guarded (try/catch) hooks** (`onDeposit` /
`onClose` / `onPurchase`), so a buggy or malicious emitter can never revert or
brick pool operations — the same non-reverting-delivery principle applied to NFT
settlement.

The `crown`/tithe top-deposit reward (a tithe on each acquisition fee accrued to
the highest-backed position, paid out on exit/dethrone) and the pro-rata
**daily-pot** purchaser rewards are now implemented in `FWAPool` and `FWAEmitter`.

**Deferred to later phases (see the plan):** live wiring/parameterization of the
CCIP↔VRF path (pending the Fase 0 spike — see `../docs/fase0-findings.md`), then
Fase 3 (frontend/indexing), Fase 4 (external audit/beta), Fase 5 (mainnet).

## Toolchain note (Hardhat, not Foundry)

The plan recommends Foundry, but its binaries ship via GitHub Releases, which is
blocked by this environment's egress policy. **Hardhat** is used instead (bundled
network needs no downloads; solc is fetched from `binaries.soliditylang.org`).
The contracts are framework-agnostic and compile under Foundry elsewhere.
`evmVersion` is pinned to **`paris`** and OpenZeppelin to **5.0.x** (no `mcopy`)
to stay portable until Fase 0 confirms the chain's ArbOS opcode support.

## Usage

```bash
npm install
npm run build          # hardhat compile
npm test               # 86 tests: Fenwick, pool (incl. dynamic pricing), freeze,
                       #           DoS, crown, emitter, claim, periphery, keeper
                       #           randomness + bot, VRF adapter, pack vault,
                       #           equity baskets (+ adversarial pass), randomized
                       #           invariants

# Fase 0 — inventory the real testnet before committing further:
npx hardhat run scripts/probe-chain.js --network robinhood-testnet

# Deploy the full stack. ADAPTER=keeper (default) | mock | ccip:
npx hardhat run scripts/deploy.js --network robinhood-testnet

# Run the keeper bot (required for draws to resolve on the keeper adapter).
# Stateless: every tick re-derives the chain from the secret + on-chain state.
ADAPTER=0x... KEEPER_MASTER_SECRET=0x<32 bytes> \
  npx hardhat run scripts/keeper-bot.js --network robinhood-testnet
```

Networks are preconfigured in `hardhat.config.js` (`robinhood-testnet` = 46630,
`robinhood-mainnet` = 4663) with Blockscout verification endpoints. Set
`DEPLOYER_MNEMONIC` (see `.env.example`) to deploy.

## Fase 0 go/no-go gate

Before investing in Fase 1+, the probe + a CCIP round-trip spike must confirm:
measured VRF-via-CCIP latency (p95) and per-draw cost are acceptable, contract
deployment/verification works, ArbOS supports the chosen opcodes, and the mainnet
ToS carries no blocker.

**The randomness leg of G0 is now satisfiable without any external provider:**
the `KeeperHashChainAdapter` reproduces the scheme StockRip already runs live on
Robinhood Chain mainnet, at a documented (weaker-than-VRF) trust level — see
`audit/threat-model.md`. VRF-via-CCIP becomes an upgrade decision rather than a
launch blocker.
