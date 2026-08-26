# $FWA token launch — DEX plan & mainnet LP test

Live findings from testing the $FWA/HYPE liquidity pool on HyperEVM mainnet
(chain 999) with a disposable burner wallet and a launch-spec test token.
This is the reference for the real launch.

## DEX choice: HyperSwap V2

| Criterion | Why it decides |
|---|---|
| **Largest HyperEVM TVL** (~$57–80M vs KittenSwap ~$32M) | deepest routing, most organic volume |
| **Uniswap V2 AMM** (`x*y=k`, full-range) | the LP position is a plain **ERC-20 LP token** the owner holds and can redeem anytime — no lock, no forced burn |
| **Supports fee-on-transfer** (`*SupportingFeeOnTransfer*` router fns) | required if $FWA keeps its 1% DEX fee; V3 / Algebra concentrated-liquidity DEXs (HyperSwap V3, KittenSwap) **cannot** hold a fee-on-transfer token |

Verified on-chain (mainnet 999):

- **Router (V2):** `0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A` — 12 076 bytes, `factory()` and `WETH()` resolve, `getAmountsOut` returns correct quotes.
- **Factory (V2):** `0x724412c00059bf7d6ee7d4a1d0d5cd4de3ea1c48` — 3 233 live pairs.
- **WHYPE (wrapped HYPE):** `0x5555555555555555555555555555555555555555` (HyperEVM system contract).

> The addresses on `docs.hyperswap.pro` (`0xda0f518d…` / `0x4df03980…`) have **no
> code on mainnet 999** — they are testnet/stale. Use the verified ones above.

## Market-cap target: ≤ $5,000 at launch

Market cap is set purely by the **seed price**, not by how much capital you add.
With 100,000,000 total supply and HYPE ≈ $79 at test time, a seed price of
**$0.000049 / FWA** gives a $4,900 implied cap. Verified live: seeded a pool and
read the reserves back → **implied MC = $4,900.03 ✅**.

More capital at the same price ratio = same MC, just deeper liquidity:

| FWA seeded | HYPE needed (≈$79/HYPE) | ≈ USD | Implied MC |
|---|---|---|---|
| 5,000,000 (5%) | ~3.2 HYPE | ~$250 | $5,000 |
| 10,000,000 (10%) | ~6.4 HYPE | ~$500 | $5,000 |
| 20,000,000 (20%) | ~12.7 HYPE | ~$1,000 | $5,000 |

The launch script must read the **live** HYPE price at seed time and compute the
FWA amount so the ratio lands the cap under $5k (we target $4,900 for margin).

## LP is withdrawable anytime — PROVEN on mainnet

The user's hard requirement: **never lose the liquidity; redeem on demand, burn
only if/when the owner chooses.** Validated end to end:

- The LP position is an ERC-20 (`pair` token) held by the **owner's wallet**, not
  burned, not locked, not sent to a timelock.
- Redeemed 50%, then 100%, via `router.removeLiquidity(FWA, WHYPE, …)` →
  received FWA + WHYPE back, then `WHYPE.withdraw` → native HYPE. Every test-HYPE
  was recovered to the owner. **Zero funds stranded.**
- Burning later (if the owner decides) is just sending the LP token to
  `0x…dead` — an owner-only action that nothing else can force.

## Open item before public trading — HyperEVM system-WHYPE friction

One thing did **not** cleanly complete in headless testing and must be closed
before launch — it is an integration detail, **not** a token or pool defect:

- **`pair.swap(...)` called directly works** (executed on-chain, ~76k gas) — the
  pool is genuinely tradeable and the 1% fee mechanics are fine at the pair level.
- **Router-mediated swaps and the native-HYPE helpers** (`swapExactETHForTokens…`,
  `removeLiquidityETH`) hit **empty reverts / `TransferHelper: TRANSFER_FAILED`**.
  Root cause traced to the **HyperEVM system WHYPE (`0x5555…`)**, which reverts
  with no reason string on conditions a standard WETH9 handles differently.
  `removeLiquidity` to **WHYPE** works; only the **native-HYPE unwrap leg** fails.

Since 3,233 pairs trade on this router in production, this is a
harness/interaction issue, not a broken router. Close it before launch by:

1. Reproducing a swap through the **HyperSwap app UI** on the real pair (the app
   uses the correct multicall/permit2 path the raw router calls skip), and/or
2. Testing against HyperSwap's current published **periphery** (multicall router)
   rather than the bare `UniswapV2Router02` ABI, and/or
3. Deciding on the **1% transfer fee**: even though it was not the swap blocker
   here (swaps reverted with the fee off too), a fee-on-transfer token routinely
   breaks aggregators (1inch/others) and CEX deposits. The pack protocol already
   earns treasury revenue, so **launching $FWA as a plain ERC-20 (no transfer
   fee)** removes a whole class of DEX/CEX friction. Strong recommendation.

## Real-launch checklist (when the owner is ready)

1. Deploy `FWAToken` with **cap = supply = 100,000,000**, `admin`/`feeWallet` =
   the **owner's real wallet or multisig** (not a burner). Decide fee vs no-fee.
2. Mint the supply; allocate per tokenomics (LP + `FWAEmitter` emissions +
   `FWAClaim` community airdrop).
3. `openTransfers()`.
4. Big blocks on (owner must be a HyperCore user first) → `factory.createPair` →
   big blocks off.
5. `addLiquidity` at the live-price ratio for ≤$5k MC; **keep the LP tokens in
   the owner wallet** (redeemable anytime).
6. If keeping the fee: `setDexPair(pair, true)`.
7. Verify a real buy/sell through the HyperSwap app, publish the official CA on
   the site (restore the "Official CA" bar with the real address).

## Test artifacts (disposable — burner-owned, mock token)

Launch-spec test token `FWA2` (100M cap/supply):
`0xa7A3984B38cA0d8bBDf41A354A68E68aac74F4a5`. Test pair:
`0xf2A45026FB3da362fC71d78bb2303C6DE0A658FB`. All liquidity was withdrawn; these
are throwaway and are **not** the launch token.
