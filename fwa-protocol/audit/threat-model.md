# FWA Protocol — Threat Model

## Primary adversary: the single sequencer

RobinhoodChain runs **one Robinhood-operated sequencer** with FCFS ordering and
full mempool visibility. It can reorder, delay, insert, and censor transactions,
and it chooses *when* a randomness-fulfillment tx lands and what is bundled
around it. This is a stronger adversary than base-Ethereum FWA faced, and it is
exactly the class of attack that drained the original FWA (state mutated between
the VRF request and its callback).

**Mitigations in this design:**
- **Freeze-at-request** (invariant 1): the selected position is fixed at request
  time; the sequencer cannot mutate the selection set while a draw is in flight
  because deposits/withdrawals/crown-claims revert during `drawInFlight`, and the
  callback performs no selection.
- **Order-invariant settlement**: `settle` is a separate, permissionless step;
  its outcome depends only on the frozen snapshot + the delivered word, not on
  surrounding transactions.
- **No naked native pseudo-randomness**: the design never uses
  `block.prevrandao` (constant on Nitro), a bare `blockhash`, or timestamp as
  the randomness source. The `KeeperHashChainAdapter` *does* fold
  `blockhash(seedBlock)` into its word, but only mixed with a keeper
  commit-reveal preimage that was fixed before the seed block existed — see
  the dedicated section below for that adapter's weaker trust model.
- **Residual risk**: after `Fulfilled`, the buyer chooses Keep/SellBack having
  seen the word — this is intended (mirrors FWA) and is not exploitable beyond
  the intended choice, because both outcomes are priced in and the buyer already
  paid the escrowed price. The sequencer cannot change *which* position was won.

## Attack surface by actor

| Actor | Can they… | Mitigation |
|---|---|---|
| Malicious depositor | brick the pool via a revert-on-transfer NFT? | No — non-reverting `_deliver` + escrow (invariant 5). |
| | force selection onto a specific NFT? | No — freeze-at-request; selection is VRF-driven over the frozen snapshot. |
| | grief via the crown? | Dethroning pays the incumbent; crown never touches weights. |
| Malicious purchaser | double-settle / settle after expiry / re-enter? | Draw state machine + `nonReentrant` + pull-based credits. |
| | drain more than owed via reentrancy? | CEI + `nonReentrant` (test: reentrancy/double-spend). |
| Malicious/compromised adapter | supply a chosen word? | Trust assumption (owner-set); blast radius = one draw. Mitigate with a provider whose secret is revealed only post-request (Pyth Entropy / VRF). |
| Keeper (`KeeperHashChainAdapter`) | choose the word? | Not alone — its chain link was committed before the seed block existed; the word also depends on `blockhash(seedBlock)`. |
| | withhold a reveal it dislikes? | Yes (the real weakness): seeing the would-be word, it can go silent and let the draw expire. Cost: buyer refunded, incident recorded via `skipStale`, bond slashable, publicly visible. |
| | brick the adapter by vanishing? | No — `skipStale` is permissionless after the blockhash window; the pool refunds via `expireDraw`. |
| Sequencer + keeper (colluding) | grind the outcome? | Partially: on Arbitrum Orbit `blockhash` is chain-derived and sequencer-influenced, so collusion allows biased retries. Accepted launch risk (StockRip-parity); the VRF adapter is the remedy, swappable with zero pool changes. |
| Paused/hostile basket leg (`EquityBasket`) | brick `unwrap` and lock the healthy legs? | No — `unwrap` delivers each leg via a non-reverting payout; a failing leg is escrowed to `stuckToken` and pulled later via `claimStuckToken`. The basket burns and healthy legs pay out regardless (`adversarial-review-keeper-basket.md`). |
| Malicious emitter | brick pool operations? | No — guarded try/catch hooks (invariant 16). |
| Malicious backing token | break accounting (fee-on-transfer/rebasing)? | Out of scope — backing is a trusted config-time ERC-20. |
| Rebasing basket token (`EquityBasket`) | strand a leg on unwrap? | Out of scope — wrapped tokens are a trusted, owner-allowlisted set assumed non-rebasing; a negative rebase escrows (never reverts) the short leg. |
| Pack buyer (dynamic pricing) | be overcharged silently? | Bounded: the dynamic extra is hard-capped (base + cap ≤ 100%), previewed on-chain via `dynamicExtraBps`, and `startDraw(maxPrice)` still gives every buyer slippage protection. Enabling/tuning is owner-only. |
| Replenish cranker (`PackVault`) | grief the vault by cranking repeatedly? | Only fires below the pool floor, rate-limited by cooldown, spends only pre-funded inventory, and reverts loudly when empty — draining-to-floor is the feature, not a bug. |
| Third party | claim someone's NFT/credit/reward? | Recipient checks on `claimStuckNFT`, `withdrawCredit`, `claimEarnings`, `claimStuckToken`, emitter `harvest`/`claim`. |

## KeeperHashChainAdapter — explicit trust downgrade

The launch randomness backend trades VRF's cryptographic guarantees for
oracle-independence. Word = `keccak256(preimage, keccak256(requestId,
blockhash(seedBlock)), requestId)` with `seedBlock = request block + 5` and
`keccak256(preimage) == committed head`.

What an auditor should check:
- **Commit binding**: a reveal only verifies against the head committed before
  the request; the keeper cannot substitute a different preimage after seeing
  the seed blockhash. Head rotation (`commitHead`) is blocked while a request
  is pending.
- **Selective-abort bias**: the keeper's one real lever is *not revealing*.
  Each abort burns buyer goodwill, records a `slashableSkips` incident, and is
  slashable against the ETH bond. This bounds, but does not eliminate, bias —
  identical to the scheme StockRip operates in production on this chain.
- **Blockhash semantics on Orbit**: `block.number` is the synced L1 block
  number and `blockhash` is a chain-derived pseudo-hash. The 256-block reveal
  window (~51 min of L1 blocks) sits inside the pool's 1 h `expireDraw`
  timeout, so a stale request always resolves: `skipStale` frees the adapter,
  `expireDraw` refunds the buyer.
- **One pending request**: matches the pool's serialized draws by design. A
  second concurrent consumer would be denied service until the first request
  resolves — a documented limitation, not a bug.

## Owner powers (centralization)

The owner (production: multisig + timelock) can:
- Set `surchargeBps`, cuts, `settlementFeeBps`, `bidBps`, windows, `requestTimeout`.
- Set `feeRouter`, `emitter`, crown params, whitelist entries, the active adapter.
- Cannot: seize a user's NFT or backing credit, or alter an in-flight draw's
  outcome. There is no `mint`/`drain`/`pause-and-steal` path.

**Recommended**: timelock on parameter changes; a Security-Council-style multisig;
publish an allowlist-of-collections policy. See `runbook.md`.

## Chain-level risks (from the viability study)

- The RollupProxy admin can enable a **deployer allowlist** with no delay
  (chain is not L2BEAT Stage 1) and the sequencer can censor. These are outside
  the contracts' control; mitigation is operational (deploy early, engage
  Robinhood, multi-chain contingency). See `../../docs/analise-fwa-robinhoodchain.md`.
- Randomness provider availability (CCIP router / Pyth Entropy addresses) is
  **not yet confirmed on-chain** — a Fase 0 gate. See `../../docs/fase0-findings.md`.
