# FWA Protocol — Invariant Specification

The properties the protocol must uphold. Each notes where it is enforced and
which tests exercise it. Auditors: try to break these.

> The fund-safety and structural invariants (4, 7, 8, 9, 10, 11, 13, 14) are
> additionally checked by **randomized property testing** (`test/Invariants.test.js`):
> 4 seeds × 60 rounds of random deposits/draws/settlements/withdrawals/claims,
> asserting solvency (`poolBalance ≥ everything owed`, gap = only accumulator
> dust), Fenwick/weight consistency, crown validity, and active-set agreement
> after every operation, then a full drain to dust.

## Selection & freeze-at-request (the exploit-critical core)

1. **Frozen selection set.** The position selected by a draw is a pure function
   of `(draw.randomWord, draw.totalWeightSnapshot, the Fenwick tree state)` fixed
   at request time. No action between `startDraw` and `settle` may change which
   position is selected.
   - Enforced by: draws are **strictly serialized** (`drawInFlight`), and
     `deposit`/`withdraw`/`claimTopSpot` all `require(!drawInFlight)`. Crown
     mutations never touch weights. `_settle` reads the live tree, which is
     provably identical to the snapshot because nothing could mutate it.
   - Tests: `FWAPool.test.js` "freezes the pool while a draw is in flight",
     "selects the position determined by the frozen snapshot + random word".

2. **Minimal, resilient callback.** `fulfillRandomness` only stores the word,
   performs no selection/transfer, and never reverts on a stale/expired draw.
   - Test: "ignores stale fulfillment on an expired draw".

3. **Randomness liveness.** A never-fulfilled draw is refundable
   (`expireDraw` after `requestTimeout`); a fulfilled draw is always resolvable
   (`settle` by buyer, else `finalize` by anyone after the window).

## Fund safety & conservation

4. **Per-position solvency.** Each position's `backing` is tracked separately and
   never pays another position. The contract never pools backing.
5. **No draw can brick the pool.** A reverting NFT `transferFrom` at settlement
   must never prevent `drawInFlight` from clearing. Delivery is non-reverting
   (`_deliver` try/catch → escrow to `nftClaims`); recovery via `claimStuckNFT`.
   - Test: `DoS.test.js` "a reverting NFT transfer escrows the NFT instead of
     bricking the pool".
6. **Pull-based payouts.** All value out (earnings, refunds, sell-back proceeds,
   crown tithe, protocol fees) accrues to `backingCredit` and leaves only via
   `withdrawCredit`. No push transfers of the backing token in settlement.
7. **Fee accounting is solvent.** `_distributeFee` adds to `accFeePerPosition`
   only; the sub-wei remainder stays in the accumulator (solvent direction) and
   is never double-credited to the protocol.

## Pricing & weights

8. **Inverse weight.** `weight = 1e36 / backing`; `deposit` reverts if that is 0.
9. **Harmonic-mean price.** `acquisitionPrice = (weightedBackingTotal / totalWeight)
   * (BPS + surchargeBps) / BPS`. (Divide-before-multiply is intentional and
   sub-unit; see `findings.md`.)
10. **Fenwick correctness.** For any `target < totalWeight`, `findByPrefix(target)`
    returns the unique active leaf whose cumulative-weight range contains it;
    lazily-deleted leaves (weight 0) are never selected. Updates propagate to a
    fixed `CAPACITY`, so dynamic growth cannot desync ancestor nodes.
    - Tests: `FenwickTree.test.js` (all).

## Crown / tithe

11. **Single crown.** At most one active position is the crown (`topListingId`);
    `0` = vacant. The first deposit takes a vacant crown; a challenger takes it
    only if `backing*BPS >= topBacking*(BPS+topThresholdBps)`.
12. **Tithe conservation.** The tithe carved from each acquisition fee accrues to
    `topPot` and is paid **exactly once** — to the holder on crown exit
    (`_deactivate`) or to the dethroned incumbent (`_claimTopSpot`). It is never
    both. When the crown is vacant, no tithe is carved (equal split).
    - Tests: `Crown.test.js` (all three).
13. **Crown never desyncs.** `topListingId` always references an active position
    or is 0; `_deactivate` of the crown vacates it.

## Emissions ($FWA)

14. **Bounded emissions.** Depositor rewards are bounded by
    `depositorRatePerSec * (endTime - startTime)`; purchaser rewards are bounded
    by `purchaserBudget`. The two streams are **segregated** — purchaser claims
    decrement `purchaserBudget` and cannot strand depositor emissions.
    - Tests: `FWAEmitter.test.js` "caps day-pot claims at the reserved budget".
15. **Daily-pot correctness.** A day is claimable only after it closes; each
    account claims once per day; `sum(user claims for a day) <= purchaserDailyPot`
    (and <= remaining budget).
16. **Guarded hooks.** A reverting/malicious emitter can never revert or brick any
    pool operation (`_notify*` are try/catch).
    - Test: `FWAEmitter.test.js` "a reverting emitter can never brick the pool".

## Access control

17. Only the owner may set params/fee-router/emitter/crown-params/whitelist/adapter.
18. Only the active adapter may call `RandomnessRouter.fulfill`; only the router
    may call `FWAPool.fulfillRandomness`; only the pool may call emitter hooks.
