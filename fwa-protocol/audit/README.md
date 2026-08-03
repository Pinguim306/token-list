# FWA Protocol — Audit Readiness Package

This directory is the entry point for an external security review of the Fake
World Assets (FWA) protocol on RobinhoodChain.

## Scope

**In scope (review these):**

| Contract | LoC-ish | Notes |
|---|---|---|
| `contracts/core/FWAPool.sol` | ~620 | Core: positions, weighted selection, freeze-at-request draws, settlement, crown/tithe, pull-based credits, guarded emitter hooks, dynamic dispersion pricing (sumBacking accounting, capped extra, off by default). **Highest priority.** |
| `contracts/libraries/FenwickTree.sol` | ~90 | O(log n) weighted selection; fixed-capacity dynamic growth. |
| `contracts/core/FWAFactory.sol` | ~40 | Pool deployer/registry. |
| `contracts/core/FWAWhitelist.sol` | ~35 | Collection curation, sticky block. |
| `contracts/core/FeeRouter.sol` | ~70 | Protocol-fee splitter. |
| `contracts/token/FWAToken.sol` | ~90 | ERC-20 reward token; cap, launch gate, DEX fee. |
| `contracts/token/FWAEmitter.sol` | ~220 | Emissions: √backing depositor rewards + daily-pot purchaser rewards. |
| `contracts/token/FWAClaim.sol` | ~60 | Merkle distribution. |
| `contracts/randomness/RandomnessRouter.sol` | ~70 | Consumer ⇄ adapter indirection. |
| `contracts/randomness/KeeperHashChainAdapter.sol` | ~180 | **Launch randomness backend**: keeper commit-reveal hash chain × future blockhash, stale-skip liveness, slashable bond. Weaker-than-VRF trust model documented in `threat-model.md` — review the selective-abort analysis. |
| `contracts/periphery/PackVault.sol` | ~230 | Operator pack factory: template validation, bundle mint loop, permissionless replenish crank (floor/cooldown/inventory guards), owner passthroughs. |
| `contracts/basket/EquityBasket.sol` | ~155 | ERC-721 wrapper over allowlisted fungible tokenized equities (internal ledger). Review wrap/unwrap CEI, balance-delta accounting, and the non-reverting payout + `claimStuckToken` escrow path. |

**Out of scope / lower priority:**
- `contracts/randomness/CCIPVRFAdapter.sol`, `VRFRequester.sol` — production
  *skeletons* with local minimal CCIP/VRF interfaces. To be replaced with the
  canonical `@chainlink/contracts-ccip` types and re-reviewed before mainnet
  (see `../README.md` and `../../docs/fase0-findings.md`). Not wired live yet.
- `contracts/mocks/*` — test-only.

## Trust model / assumptions

- **`backingToken`** (e.g. USDG) is a trusted, non-rebasing, non-fee-on-transfer
  ERC-20 fixed at pool construction. Fee-on-transfer/rebasing backing is NOT
  supported and would break accounting (documented, not a target).
- **Owner** (a multisig/timelock in production) can set params, fee router,
  emitter, crown params, whitelist, and the active randomness adapter. Owner is
  trusted not to be malicious; still, owner powers are enumerated in
  `threat-model.md`.
- **RandomnessRouter adapter** is owner-set and trusted to deliver an unbiased
  word. The single-sequencer threat is analyzed in `threat-model.md`.
- **RobinhoodChain** runs a single Robinhood-operated sequencer (FCFS, can
  reorder/delay/censor). Designs must not depend on transaction-ordering secrecy.

## How to reproduce

```bash
cd ..                       # fwa-protocol/
npm install
npm run build               # solc 0.8.26, evmVersion paris
npm test                    # 86 tests, incl. randomized invariants (freeze-at-request, DoS, crown, emitter)
slither . --config-file slither.config.json   # static analysis (see audit/slither-output.txt)
```

## Review coverage already performed

- **Fase 1 core** and **Fase 2 tokenomics** each had a **multi-agent adversarial
  review** (multiple lenses → per-finding adversarial verification). Confirmed
  findings and their fixes are in `findings.md`.
- **Crown/tithe + daily-pot** (core completion) had **Slither static analysis +
  manual review**, but NOT the multi-agent adversarial pass. **Auditors should
  focus extra attention here** — see `findings.md` for the exact coverage matrix.
- **`KeeperHashChainAdapter` + `EquityBasket`** now have a focused adversarial
  review — see `adversarial-review-keeper-basket.md`. It examined reentrancy,
  double-serve, bond custody, and selection integrity (adapter) and reentrancy,
  cross-basket isolation, and payout DoS (basket), fixed one issue (a hostile
  basket leg could brick `unwrap`; now escrowed via non-reverting payout +
  `claimStuckToken`), and records the residual trust assumptions. External audit
  still recommended before mainnet.

See `invariants.md`, `threat-model.md`, `findings.md`, and `runbook.md`.
