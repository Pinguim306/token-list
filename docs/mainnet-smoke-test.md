# HyperEVM mainnet smoke test — 2026-08-25

A live, end-to-end validation of the FWA stack on **HyperEVM mainnet
(chainId 999)**, run with a disposable burner deployer and mock assets
(mock USDG backing, mock pack NFT). It is **not** a production launch —
it proves the deploy pipeline, the keeper randomness round-trip, and the
verification route against the real chain. Total cost: **~0.002 HYPE
(≈ US$0.10)** out of a 0.2 HYPE budget.

## Deployed addresses (burner-owned, disposable)

Deployer/keeper/owner: `0x1061E3e8312B636F9323e99871BA0bd78D5F2E97`

| Contract | Address |
|---|---|
| FWAPool (deployed direct, no factory) | `0x3B5a8e4A65646C29d052D73021Ae40767f3833Ab` |
| RandomnessRouter | `0x479F0338bDFe872cee32628684AC077bF544D720` |
| KeeperHashChainAdapter | `0x59B348aFd85c2896f98Aa007C5F8ba2E7CD19AB2` |
| FWAWhitelist | `0x02B9849a15B8e0E9a6F9180c7387a076C1bC97De` |
| FeeRouter | `0x65f2975F9BFF2906EC548eD0966a73953E97159C` |
| EquityBasket | `0x6ba0Fa99263AED02945F67F6b30CA1C5fA30c4fe` |
| PackVault | `0x2De171c9be351b07B9BB6730C3472b33ACCE0AB3` |
| FWAToken | `0x3249f84F0D44c6dFc52BfCa09369Be62F498455f` |
| FWAEmitter | `0xE56815B37d3131F22e8944d1A8B34F419724829F` |
| MockERC20 backing ("Mock USDG") | `0xd6922791E8c08BD4431d01ad26DEe2A434491b43` |
| MockERC721 pack | `0xf863a3e5ff9dae91E06d196e299570cA34618A2D` |

All ten protocol contracts are **verified on Sourcify** (nine
`exact_match`, one `match`) — browsable at
`https://repo.sourcify.dev/999/<address>` and on
[hyperevmscan.io](https://hyperevmscan.io).

## What was exercised

1. **Full deploy, small blocks only** (16 txs): the whole stack fit 1s/3M
   small blocks by constructing `FWAPool` directly instead of through
   `FWAFactory`. No big-block toggle, no HyperCore onboarding needed.
2. **Runbook parameterization**: `setParams(..., requestTimeout=600)` — the
   ~4-minute blockhash-window tuning applied at deploy time.
3. **End-to-end draw with real randomness** (blocks `44155570 → 44155581`,
   ≈ 11 s total): deposit (pack NFT + 50 USDG backing) → keeper hash-chain
   commit (50 links) → `startDraw` at the pool price (55 USDG = harmonic
   price + 10% surcharge, exactly as derived) → seed block +5 → keeper
   `reveal` → word delivered through the router (draw `Fulfilled`) →
   `settle(Keep)` → NFT delivered to the buyer, draw `Settled`.
4. **Sourcify v2 verification** of all contracts, no API key, no
   constructor-args plumbing.

## Measurements (live chain)

| Item | Measured |
|---|---|
| `FWAFactory` deploy | **3,075,665 gas — exceeds the 3M small-block cap** (the only contract that does) |
| `FWAPool` direct deploy | **2,900,368 gas — fits small blocks** (96.7% of cap) |
| Full deploy + wiring (16 txs) | ~14.4M gas ≈ 0.00144 HYPE at ~0.15 gwei |
| E2E draw (deposit → settle, 12 txs) | ~2.3M gas ≈ 0.0002 HYPE |
| Draw latency (request → settled) | ≈ 11 s (11 small blocks) |

## Findings folded back into the repo

- **Sourcify sunset its v1 API** — `hardhat verify`'s Sourcify integration
  posts to removed endpoints and always fails. Replaced by
  `fwa-protocol/scripts/sourcify-verify.js` (v2 API); the config's plugin
  Sourcify mode is disabled and the runbook updated.
- **The public RPC load balancer has lagging replicas** — two transient
  `invalid block height` / `could not coalesce` errors across ~30 requests.
  Deploy tooling needs retries (the smoke scripts retried and succeeded);
  worth remembering for the keeper bot in production (use a dedicated RPC).
- **Factory-less deploy is a viable no-big-blocks path** — documented in the
  runbook as option (b) alongside the standard factory route.
