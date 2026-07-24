# FWA Protocol — Deployment & Emergency Runbook

## Pre-deploy (Fase 0 gate — must pass first)

Do not deploy to mainnet until `../../docs/fase0-findings.md` items are closed,
especially:
1. A verifiable randomness adapter is confirmed reachable on RH Chain (CCIP↔VRF
   round-trip measured, or Pyth Entropy onboarded) and wired into
   `RandomnessRouter`.
2. External audit complete with no open highs.
3. Backing token (USDG) address and decimals confirmed.

## Deploy order

1. `FWAWhitelist(owner)` → allow the intended collections.
2. `RandomnessRouter(owner)` → `setAdapter(<CCIPVRFAdapter | EntropyAdapter>)`.
3. `FeeRouter(owner, recipients, sharesBps)`.
4. `FWAFactory(owner)` → `createPool(backingToken, router, whitelist, feeRouter, owner)`.
5. `router.setConsumer(pool, true)`.
6. `FWAToken(cap, admin, feeWallet)`; `FWAEmitter(fwa, owner)`; `emitter.setPool(pool)`;
   `pool.setEmitter(emitter)`; `fwa.setFeeExempt(emitter, true)`;
   `emitter.configure(start, end, depositorRatePerSec, purchaserDailyPot)`;
   `emitter.setPurchaserBudget(x)` with `x >= EMISSION_DAYS * purchaserDailyPot`
   (under-funding causes intra-day purchaser claim races — see review note C-N1);
   fund the emitter with at least `depositorCap + purchaserBudget` $FWA.
7. Verify all contracts on Blockscout (`forge verify-contract --verifier blockscout`
   or hardhat-verify against the `robinhood-*` networks).

Reference wiring: `../scripts/deploy.js` (uses a Mock adapter for testnet).

## Ownership & guarded launch

- Transfer ownership of pool/router/whitelist/feeRouter/emitter to a **multisig
  (Safe)** and, ideally, a **timelock** on parameter changes.
- **Loading phase**: keep the pool stocked before enabling draws (deposits are
  open; draws only make sense once positions exist).
- Set conservative caps initially; raise gradually (Gate G5).

## Monitoring

- Watch every `DrawStarted` without a timely `DrawFulfilled` (randomness
  liveness). If p95 latency spikes, investigate the adapter/CCIP path.
- Watch `NFTEscrowed` events (a collection reverted delivery) → follow up with the
  recipient / consider `blockAsset` on the whitelist.
- Watch `StaleFulfillment` (late randomness on refunded draws).

## Emergency procedures

| Situation | Action |
|---|---|
| Randomness adapter compromised/failing | `router.setAdapter(newAdapter)`; in-flight draws expire and refund via `expireDraw` after `requestTimeout`. |
| A collection turns malicious | `whitelist.blockAsset(collection)` (sticky — blocks new deposits; existing positions still settle/escrow safely). |
| Stuck NFT after a paused collection | Recipient calls `pool.claimStuckNFT(asset, tokenId)` once transfers work again. |
| Draw wedged in `Requested` (no fulfillment) | Anyone calls `expireDraw(drawId)` after `requestTimeout` → buyer refunded, pool unlocks. |
| Draw wedged in `Fulfilled` (buyer inactive) | Anyone calls `finalize(drawId)` after the settlement window → default Keep, pool unlocks. |
| Parameter mis-set | Owner `setParams` / `setCrownParams` / `emitter.configure`. |

There is intentionally **no owner "drain" or "seize" switch** — the mitigations
above resolve every stuck state without custody of user funds. The historical
FWA `withdraw-only` freeze is unnecessary here because no external call in the
settlement path can wedge the pool (invariant 5).

## CI / reproducibility

- `fwa-protocol` CI (`.github/workflows/fwa-protocol-ci.yml`): build + 33 tests.
- Static analysis is run manually: `slither . --config-file slither.config.json`.
