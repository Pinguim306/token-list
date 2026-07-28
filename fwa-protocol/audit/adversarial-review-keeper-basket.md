# Adversarial review — KeeperHashChainAdapter & EquityBasket

Focused adversarial pass on the two contracts the audit package flagged as
lacking one (`audit/README.md`). This is a careful manual review, not a
substitute for an external audit; it records the attack surfaces examined, what
held, the one issue fixed, and the residual trust assumptions.

Scope: `contracts/randomness/KeeperHashChainAdapter.sol`,
`contracts/basket/EquityBasket.sol`. Method: enumerate each external entry
point, adversary, and state transition; attempt to break custody, liveness,
selection integrity, and reentrancy; encode the verified invariants as tests.

---

## KeeperHashChainAdapter

### Surfaces examined — held

| Attack | Why it fails |
|---|---|
| Reentrancy through `reveal → router.fulfill → consumer` | State (`chainHead`, `revealsRemaining`, `pendingRequestId`, `seedBlock`) is fully updated **before** the external `fulfill` call (CEI). A reentrant `requestRandomness`/`reveal` sees `pendingRequestId == 0` and cannot corrupt an in-flight reveal. The consumer callback (FWAPool) is store-only and never calls back. |
| Double-serve / resurrecting a skipped request | `skipStale` zeroes `pendingRequestId`; a later `reveal` reverts `KHC: no pending`. No word is delivered twice, no draw resurrected. *(test: "no double-serve")* |
| `revealsRemaining` underflow | A pending request required `revealsRemaining > 0` at request time, and `commitHead` is blocked while pending, so it is still ≥ 1 at reveal. |
| Reveal / skip window overlap | `reveal` requires `block.number ≤ seedBlock + 256`; `skipStale` requires `> seedBlock + 256`. Disjoint — exactly one is ever valid. |
| Head rotation mid-flight | `commitHead` reverts while `pendingRequestId != 0`, so the in-flight reveal target cannot be swapped. |
| Bond theft / reentrancy | `withdrawBond` and `slash` follow CEI (`bond -=` before the call). `withdrawBond` is keeper-only and blocked while pending or with an unanswered skip; `slash` is owner-only. Keeper rotation requires `bond == 0`, so one keeper's collateral can never pass to another. |
| Request cross-wiring | The adapter is `drawId`-agnostic; it echoes the router's `routerRequestId`, and the router maps it back to the correct `{consumer, drawId}`. The word cannot land on the wrong draw. |

### Inherent weakness (documented, not a regression)

**Keeper selective abort.** At reveal-decision time the seed blockhash is public
and the preimage is known to the keeper, so the keeper knows the exact word — and
thus which position the pool will select — before revealing. It can withhold a
reveal it dislikes. This is intrinsic to any commit-reveal-with-known-blockhash
scheme (it is what StockRip runs in production). It is bounded, not eliminated:
each abort burns buyer goodwill, records a `slashableSkips` incident, is
slashable against the ETH bond, and is publicly visible. A colluding
keeper + sequencer could additionally grind the blockhash. The router indirection
makes a VRF adapter a drop-in replacement with zero pool changes — that is the
upgrade path, and it is the reason the trust downgrade is acceptable at launch.

### Residual operational note

A recorded `slashableSkips` incident freezes the **entire** keeper bond until the
owner adjudicates (`slash`, with `amount = 0` to forgive). This is intended —
the owner (a multisig/timelock in production) is the adjudicator — but it couples
bond liveness to owner responsiveness. Documented, not changed.

---

## EquityBasket

### Surfaces examined — held

| Attack | Why it fails |
|---|---|
| Reentrancy (wrap/unwrap) | Both are `nonReentrant` (shared guard), so a malicious token's transfer hook cannot re-enter either — including cross-function (wrap↔unwrap). `wrap` uses `_mint` (no ERC-721 receiver callback). |
| Cross-basket balance contamination | `wrap` records each leg by **balance delta** (`after − before`), so shared-token balances across baskets never conflate. *(test: "cross-basket balance isolation")* |
| Fee-on-transfer under-crediting | Deposits are recorded at what actually arrived; `require(got > 0)` rejects a token that transferred nothing. |
| Basket-content injection | `wrap` always mints a fresh basket to `msg.sender`; there is no path to add to, or mutate, an existing basket. |
| Delisting locking funds | `unwrap` does not consult the allowlist, so a token delisted after wrapping is still redeemable. *(test: "delisted-but-healthy token still unwraps")* |
| Duplicate / unsorted legs | Strictly-ascending address check rejects duplicates and fixes canonical order in one pass; `MAX_TOKENS = 16` caps unwrap gas. |

### Issue found and fixed — hostile leg bricking unwrap

**Before:** `unwrap` transferred each leg with `SafeERC20.safeTransfer`, which
reverts on failure. Real tokenized equities are frequently pausable/upgradeable
by their issuer, so a single paused (or otherwise hostile) leg would revert the
**entire** unwrap, locking the healthy legs with it — the same denial-of-service
class that `FWAPool` already defends against for NFT delivery.

**Fix:** `unwrap` now delivers each leg through `_payOrEscrow`, a non-reverting
transfer that mirrors OpenZeppelin's SafeERC20 success criterion (call succeeds
and returns either nothing or a full 32-byte `true`). A leg that fails is
recorded in `stuckToken[token][to]` and emitted as `TokenEscrowed`; the basket
still burns and the healthy legs still pay out. The recipient pulls the escrowed
leg later with `claimStuckToken` once the token can transfer again. The decode
guards against short/odd return data so a hostile token cannot revert the helper
itself. *(tests: "escrows the paused leg…", "claimStuckToken pays out once…")*

### Residual trust assumption

Wrapped tokens are assumed **non-rebasing**. A negative-rebasing token could leave
the contract short of a recorded amount; that leg would escrow (not revert) until
— if ever — the balance recovers. Standard tokenized equities do not rebase, and
the token set is owner-curated. Stated in the contract NatMissing and here.

---

## Coverage

25 tests across the two contracts (10 basket, 15 adapter), including the new
adversarial cases. Full suite: **69 passing**. Run:

```bash
cd fwa-protocol && npm test
```
