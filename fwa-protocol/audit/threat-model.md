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
- **No native pseudo-randomness**: the design never uses `block.prevrandao`
  (constant on Nitro), `blockhash`, or timestamp for randomness.
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
| Malicious emitter | brick pool operations? | No — guarded try/catch hooks (invariant 16). |
| Malicious backing token | break accounting (fee-on-transfer/rebasing)? | Out of scope — backing is a trusted config-time ERC-20. |
| Third party | claim someone's NFT/credit/reward? | Recipient checks on `claimStuckNFT`, `withdrawCredit`, `claimEarnings`, emitter `harvest`/`claim`. |

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
