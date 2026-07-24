# Manual Adversarial Review — Crown/Tithe & Daily-Pot

Scope: the two areas that did **not** get the multi-agent adversarial pass —
crown/tithe in `FWAPool` (`_settleFee`, `_deactivate`, `claimTopSpot`,
`_claimTopSpot`, deposit auto-claim) and daily-pot purchaser rewards in
`FWAEmitter` (`onPurchase`, `claimDay`, `dayOf`). This documents a rigorous
manual pass: each attack vector, the code path, and the verdict.

> Result: **no fund-safety or correctness vulnerabilities found.** One minor
> operational fairness note (C-N1) that is prevented by correct funding.

## Crown / tithe

| # | Attack vector | Analysis | Verdict |
|---|---|---|---|
| C-1 | **Double-pay of `topPot`** | The pot leaves via exactly two mutually-exclusive paths, each of which zeroes it first: crown *exit* in `_deactivate` (`id == topListingId` → pay depositor, set pot/id/backing = 0) and *dethrone* in `_claimTopSpot` (pay incumbent, `topPot = 0`, install new crown at pot 0). A position cannot be both dethroned and self-deactivated in one pot cycle. | Safe — paid once. |
| C-2 | **Crown is the selected position in `_settle`** | `_settleFee` adds the tithe to `topPot` while the crown is still occupied; then `_deactivate(selectedId)` runs — if `selectedId == topListingId` the crown-exit pays out the (now larger) pot to the depositor. If `selectedId != crown`, the pot stays and the selected (non-crown) position just closes. | Correct in both branches. |
| C-3 | **Orphaned `topPot`** (crown goes inactive without payout) | `_deactivate` is the *only* path that sets `active = false` (used by `withdraw` and `_settle`); it always runs the crown-exit block. No other path deactivates a position. | No orphan possible. |
| C-4 | **Stale `topBacking`** | Backing is immutable after `deposit` (no top-up function), so `topBacking` always equals the crown position's backing until exit (reset to 0). | No desync. |
| C-5 | **Selection bias via crown ops** | Crown state (`topListingId/topBacking/topPot`) is never read by selection and never mutates Fenwick weights. `claimTopSpot` also reverts while `drawInFlight`. | Orthogonal to freeze-at-request. |
| C-6 | **Reentrancy** | `claimTopSpot` is `nonReentrant` and only writes `backingCredit` (no external call). `_claimTopSpot` from `deposit` is internal and runs before the guarded `_notifyDeposit`. | Safe. |
| C-7 | **Overflow in the challenge check** | `backing*BPS` and `topBacking*(BPS+topThresholdBps)`: backing ≤ 1e36 (weight>0 guard), ×~1e4 = 1e40 ≪ 2^256. | No overflow at realistic scale. |
| C-8 | **Grief: tiny position claims a vacant crown** | Any active position may claim a vacant crown (matches FWA's "claimTopSpot claims a vacant crown"). A larger position dethrones it via the threshold; and a low-backing crown has high selection weight, so it is drawn (and exits) quickly. No fund impact. | Economic self-correction, not a vuln. |
| C-9 | **Claim crown for an inactive position** | `claimTopSpot` requires `p.active`; the internal call from `deposit` uses a freshly-created active position. | Guarded. |

## Daily-pot purchaser rewards

| # | Attack vector | Analysis | Verdict |
|---|---|---|---|
| D-1 | **Divide-by-zero in `claimDay`** | `require(userAcq > 0)` and `total = sum of all userAcq ≥ userAcq > 0`, so `total > 0`. | Safe. |
| D-2 | **Pro-rata over-payment** | `sum_users(pot·userAcq/total) ≤ pot` because `sum userAcq = total` and floor division only rounds down; dust stays unclaimed. | Solvent, never overpays. |
| D-3 | **Double-claim** | `dayClaimed[day][account]` set before crediting. | Guarded. |
| D-4 | **Claim an open day** | `require(block.timestamp ≥ startTime + (day+1)*SECONDS_PER_DAY)`. Day N spans `[startTime+N·DAY, startTime+(N+1)·DAY)`; closed exactly at `(N+1)·DAY`. | Correct boundary. |
| D-5 | **Inflate acquisitions to game the pot** | Each acquisition = one `settle` = one draw the buyer paid the escrowed price for. Extra acquisitions cost the acquisition fee (to depositors/protocol/crown), so gaming is self-limiting and not free. | Economically bounded, not a vuln. |
| D-6 | **Depositor-emission stranding** | Purchaser payouts are capped by `purchaserBudget` (decremented in `claimDay`), segregated from the bounded depositor stream. | Segregation holds (invariant 14). |
| D-7 | **`claimDay(day, account)` permissionless** | Anyone may credit `account`'s own pro-rata reward to `account`; funds only ever reach the rightful purchaser. | No harm. |

## Minor note

- **C-N1 (operational, not a vulnerability):** if the owner funds
  `purchaserBudget` below the total daily pots for the emission period
  (`< EMISSION_DAYS × purchaserDailyPot`), the budget can bind mid-period and
  claim order within a day then affects payouts (first claimers get more).
  There is **no over-payment and no depositor-emission stranding** — only
  purchaser-vs-purchaser fairness under deliberate underfunding. **Prevented by
  funding** `purchaserBudget ≥ EMISSION_DAYS × purchaserDailyPot` (see
  `runbook.md`).

## Coverage statement

This manual adversarial review is documented but is not a substitute for the
multi-agent adversarial pass the other areas received, nor for the external
audit. It raises the crown/daily-pot coverage to: **Slither + documented manual
adversarial review + regression tests** (`Crown.test.js`, `FWAEmitter.test.js`).
