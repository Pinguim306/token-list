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
3. The **1% transfer fee has been removed** (decided): `FWAToken` is now a plain
   ERC-20 on transfer (cap + launch gate only), so it works cleanly with DEX
   routers, aggregators, and CEX deposits. Protocol revenue comes from the pack
   mechanics, not a token tax.

## Decided launch parameters

- **Token name:** `HyperFWA` · **Ticker:** `HFWA` (set in `FWAToken`'s
  constructor). The domain **hyperfwa.xyz** is the website/branding — kept out
  of the on-chain name on purpose (a URL in the token name reads as a scam
  pattern and gets flagged by explorers/aggregators).
- **Owner wallet:** `0x8ba969c2CcC040DA8307d2e418CA511901F90f15` — receives the
  supply, holds the LP tokens, and is `admin`/minter of the token.
- **Supply / cap:** 100,000,000 HFWA.
- **Token fee:** none (plain ERC-20).
- **Initial market cap:** ≤ $5,000 (seed price set from the live HYPE price).
- **LP:** kept in the owner wallet, redeemable anytime (not burned).

## Real-launch checklist (when the owner is ready)

1. Deploy `FWAToken(cap = 100,000,000, admin = owner)` — the owner wallet above.
2. Mint the supply; allocate per tokenomics (LP + `FWAEmitter` emissions +
   `FWAClaim` community airdrop). `setLaunchAllowed(emitter/claim, true)` so
   they can distribute before the market opens.
3. Decide **pool depth** (see "Pool depth vs slippage" below) — it sets how much
   HYPE and what fraction of supply go into the LP.
4. Big blocks on (owner must be a HyperCore user first) → `factory.createPair` →
   big blocks off.
5. `addLiquidity` at the live-price ratio for ≤$5k MC; **keep the LP tokens in
   the owner wallet** (redeemable anytime).
6. `openTransfers()`.
7. Deploy `PackCards(owner)` + `PackRip(hfwa, whype, pair, cards, treasury,
   0.2 HYPE, 8500, 24h, owner)`; `cards.setMinter(packRip)`; register the
   deliverable stocks (`PACKRIP=0x… scripts/setup-packrip-stocks.js`); seed
   the dStock inventory (~$15–20 per active stock, bought on the Core spot
   book and transferred to PackRip).
8. Verify a real buy/sell through the HyperSwap app, publish the official CA on
   the site (restore the "Official CA" bar with the real address) and set
   `NEXT_PUBLIC_PACKRIP_ADDRESS` on Vercel.

## Launch economics — NO pack inventory is needed; the LP is the inventory

A natural question: since users acquire $HFWA through pack sell-backs, must
packs exist in a pool at launch? **No.** PackRip packs are minted by the
purchase itself — each buyer's own payment funds that pack's escrow (85% of
the price), and the sell-back buys $HFWA **from the HFWA/WHYPE LP**. There is
no inventory to pre-fund and no way to "run out of packs":

- **Every pack is self-funded**: 0.2 HYPE in → 0.03 to the treasury, 0.17
  escrowed for that buyer's own three-way decision. Nothing is consumed from
  any pool.
- **The LP is the sell-back sink**: each sell-back INJECTS ~0.17 HYPE into the
  pool and takes $HFWA out — so sell-backs make the pool's HYPE side grow and
  push the price UP. The pool can never be drained to zero (constant product
  is asymptotic).
- **Total launch investment: the 12.7 HYPE LP + a small dStock inventory
  (below) + gas.**

## Three-way settlement — Keep / Sell back / Take the shares

The original two-way settle (keep = escrow forfeited, sell-back = 85% in
$HFWA) gave the buyer nothing tangible on Keep. The shipped PackRip settles
each pack one of THREE ways, all real on-chain outcomes:

| Option | Buyer receives | Escrow (0.17 HYPE) goes to |
|---|---|---|
| **Keep** | A **PackCards ERC-721** tagged with the drawn stock — a tradeable on-chain collectible of the pull | Treasury |
| **Sell back** | The escrow market-bought into **$HFWA** (buy pressure on the token) | The HFWA/WHYPE LP |
| **Take the shares** | The escrow's **VALUE in the drawn stock's own tokens** (HyperCore-linked dStocks) from PackRip's inventory | Treasury (which re-buys stock on the Core book) |

Take-the-shares mechanics (all verified live on chain 999 — see
`docs/tokenized-stocks-hyperevm.md`, "HyperCore-linked dStocks"):

- The draw pool is the **8 live-book dStocks** (CRCLd, SLVd, HOODd, GLDd,
  SPYd, METAd, QQQd, MUd) — real Dinari stock tokens whose HyperCore books
  are arbitraged to the real equity price.
- Pricing is read **in-contract** from the HyperCore precompiles: the stock
  at `max(spotPx, best ask)` and the HYPE credit at `min(spotPx, best bid)` —
  conservative on both legs, so crashing a thin book cannot mint shares above
  live market value; the buyer's `minShares` bounds the other direction.
- **Inventory**: PackRip holds dStock ERC-20 balances. Seed ≈ **$15–20 per
  stock (~$120–160 total, ~1.5–2 HYPE)** at launch — one pack delivers
  ~$13.9, so that covers the first take-shares on every stock; each
  take-shares sends its 0.17 HYPE escrow to the treasury, which re-buys stock
  on the Core spot book (manual at first; a CoreWriter automation can come
  later). If a stock's inventory runs dry the option reverts and the app
  offers the other two — escrow is never at risk.
- **Inventory is protocol capital, always recoverable**: `rescueToken` lets
  the owner withdraw any dStock balance anytime (buyer escrow is native HYPE
  and has no owner-reachable exit).

Simulated drain (LP seeded 20M HFWA + 12.7 HYPE; every pack sold back — the
worst case for the pool and the best case for buy pressure; Keeps only add
treasury revenue):

| Packs sold back | HYPE in pool | HFWA left in pool | Price | Implied MC | Treasury (15% cut) |
|---|---|---|---|---|---|
| 0 | 12.7 | 20.0M | 1.0× | $5.0k | $0 |
| 100 | 29.7 | 8.6M | 5.5× | $27k | ~$236 |
| 500 | 97.5 | 2.6M | 59× | $293k | ~$1.2k |
| 1,000 | 182 | 1.4M | 206× | $1.0M | ~$2.4k |
| 5,000 | 860 | 0.3M | 4,587× | $22.9M | ~$11.8k |

Reading it: volume through the packs is what re-rates the token — 1,000 packs
(~$16k of purchases) push the market cap from $5k to ~$1M while the treasury
collects its cut on every pack (15% on sell-backs, **100%** on Keeps). The
protocol needs no further capital after the seed; growth is customer-funded.

## Later — the REAL pool (FWAPool + PackVault, Fase 2)

When the full on-chain pool launches, packs there ARE inventory: EquityBasket
NFTs holding real tokenized stocks + backing, seeded via `PackVault.mintBundle`
and topped up permissionlessly by `replenishIfNeeded`. Sizing example (all
owner-tunable in the template): 50 packs × (~$5 of TSLA/NVDA/SPCX shares +
~$10 backing) ≈ **$750 of inventory** for a launch-day pool, with the
replenisher configured floor=20, bundle=10. Per this plan's own logic, that
seeding should be **funded from PackRip treasury revenue** rather than new
capital — the checkout launches first, revenue accrues, the real pool follows.

## Pool depth vs slippage (why more HYPE = healthier launch)

HyperSwap V2 is a constant-product AMM (`x*y=k`), **not** a bonding curve. Market
cap is set by the seed price; **slippage is set by pool depth** — they are
independent knobs. The pool holds only the FRACTION of supply you put in it; a
buy can never take more than what's in the pool, and each buy pushes the price
up (draining the pool is asymptotically expensive). At a $5,000 cap and HYPE
≈ $79, a balanced pool holding fraction `f` of the 100M supply needs `f × $5,000`
of HYPE, and a **$100 buy** moves it like this:

| Supply in pool | HYPE seeded | Pool TVL | $100 buy → price impact | FWA drained |
|---|---|---|---|---|
| 5% (5M) | ~3.2 HYPE (~$250) | ~$500 | **+96%** | ~1.4% of supply |
| 10% (10M) | ~6.3 HYPE (~$500) | ~$1,000 | **+44%** | ~1.7% of supply |
| 20% (20M) | ~12.7 HYPE (~$1,000) | ~$2,000 | **+19%** | ~1.8% of supply |
| 50% (50M) | ~31.6 HYPE (~$2,500) | ~$5,000 | **+8%** | ~1.9% of supply |

So a shallow pool is not a rug risk (funds are safe, LP redeemable) but it makes
early buys swing hard. The tension is real: at a very low cap, deep liquidity
means committing a large share of supply to the LP. Recommended starting point:
**10–20% of supply in the pool** (≈$500–$1,000 of HYPE) for a launch that feels
tradeable without over-committing supply. The owner tops up depth later by adding
more liquidity at the prevailing price.

## Test artifacts (disposable — burner-owned, mock token)

Launch-spec test token `FWA2` (100M cap/supply):
`0xa7A3984B38cA0d8bBDf41A354A68E68aac74F4a5`. Test pair:
`0xf2A45026FB3da362fC71d78bb2303C6DE0A658FB`. All liquidity was withdrawn; these
are throwaway and are **not** the launch token.
