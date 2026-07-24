# FWA Protocol — Findings & Resolutions

## Review coverage matrix

| Code area | Multi-agent adversarial review | Slither | Manual review | Regression tests |
|---|:--:|:--:|:--:|:--:|
| FWAPool core (positions, freeze, settlement, DoS fix) | ✅ | ✅ | ✅ | ✅ |
| Fenwick tree | ✅ | ✅ | ✅ | ✅ |
| Randomness router + adapters (skeletons) | ✅ | ✅ | ✅ | partial |
| FWAToken / FWAClaim / FeeRouter / Whitelist | ✅ | ✅ | ✅ | ✅ |
| FWAEmitter (√backing + budget) | ✅ | ✅ | ✅ | ✅ |
| **Crown / tithe** | ❌ (see note) | ✅ | ✅✅ | ✅ |
| **Daily-pot purchaser rewards** | ❌ (see note) | ✅ | ✅✅ | ✅ |

The two ❌ areas did not get the multi-agent adversarial pass, but received a
**documented manual adversarial review** (`crown-daily-pot-review.md`, 16 attack
vectors) in addition to Slither and regression tests. Auditors should still give
them focused attention.

## Confirmed findings from adversarial review (all fixed)

### F-1 · HIGH · Reverting settlement NFT transfer bricks the entire pool
A pausable/blocklisting/malicious whitelisted collection could revert
`transferFrom` at settlement, so `_settle` reverted forever, `drawInFlight`
never cleared, and every deposit/withdraw/draw was permanently frozen.
**Fix:** state effects before interaction + non-reverting delivery
(`_deliver` try/catch → escrow to `nftClaims`) + `claimStuckNFT` recovery.
Commit `bb89bc7`. Regression: `DoS.test.js`.

### F-2 · LOW · `_distributeFee` double-counted truncation dust
The sub-wei remainder was credited to the feeRouter while the same fractional
carry also stayed in `accFeePerPosition`, over-crediting the protocol over many
distributions. **Fix:** keep the carry in the accumulator only (solvent
direction). Commit `bb89bc7`.

### F-3 · LOW · Emitter commingled depositor/purchaser reward pools
Purchaser rewards (uncapped) shared one unreserved balance with bounded
depositor emissions, so purchaser claims could strand depositor rewards.
**Fix:** explicit `purchaserBudget`; purchaser claims decrement it and cap once
exhausted. Commit `bbc83ac`. Regression: `FWAEmitter.test.js`.

## Slither static analysis triage (`slither-output.txt`)

54 contracts, 50 results — **no real vulnerabilities.** Categorization:

| Detector | Location(s) | Verdict |
|---|---|---|
| `reentrancy-no-eth` | `FWAPool.startDraw` | False positive — function is `nonReentrant`; Slither does not model the guard. External call is a trusted token; state is consistent before it. |
| `reentrancy-benign` / `reentrancy-events` | deposit, `_deliver`, adapters, claim, feeRouter | Benign — guarded and/or events-after-call only; no exploitable state. |
| `divide-before-multiply` | `deposit` (weight×backing), `acquisitionPrice` (ev×BPS) | Intentional — harmonic-mean accounting; sub-unit precision loss on large values. |
| `incorrect-equality` | `FWAEmitter.pendingOf` (`shares == 0`) | Benign — internal accounting counter, not a manipulable balance. |
| `uninitialized-local` | feeRouter `distributed`/`sum`, token `fee` | False positive — standard zero-initialized accumulators. |
| `missing-zero-check` | `setEmitter` | Intentional — `address(0)` clears the emitter (documented). |
| `missing-zero-check` | `CCIPVRFAdapter.configure(vrfRequester_)` | Minor — skeleton config; add a check when wiring live. |
| `unused-return` | `startDraw`/router request ids | Intentional — ids tracked internally by the router. |
| `timestamp` | window/timeout comparisons | Intentional — timestamps are appropriate for day/window bounds on Arbitrum. |
| `low-level-calls` | `rescueETH` (skeletons) | Intentional ETH rescue. |
| `constable-states`/`immutable-states`/`unindexed-event-address`/`missing-inheritance` | skeletons/mocks | Cosmetic; no action for core. |

## Known limitations (by design, disclosed)

- **Serialized draws**: one draw in flight at a time; deposits/withdrawals pause
  during a draw. Conservative-for-safety; higher throughput (per-draw tree
  snapshots) is future work.
- **CCIP/VRF adapters are skeletons** with local minimal interfaces — not live,
  to be replaced with canonical Chainlink types and re-reviewed (Fase 0 gate).
- **Backing token** must be a plain ERC-20 (no fee-on-transfer/rebasing).
