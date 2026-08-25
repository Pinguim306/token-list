import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it works — Fake World Assets",
  description:
    "The FWA economics, spelled out: what backing really is, the three-zone backing rule, what a draw costs and pays, the settlement window, and where randomness comes from.",
};

/**
 * The deep-dive companion to the landing page's marketing tour: every number a
 * depositor or purchaser should understand before money moves. The examples
 * mirror the parameter defaults; every live screen reads the real on-chain
 * values.
 */

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 mb-3 scroll-mt-24 font-display text-2xl text-ink">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="my-3 font-body text-[15px] leading-relaxed text-muted">{children}</p>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <b className="font-semibold text-ink">{children}</b>;
}

const TOC = [
  ["loop", "The loop"],
  ["backing", "Backing is three things at once"],
  ["rule", "The backing rule"],
  ["draw", "What a draw costs — and pays"],
  ["settlement", "The settlement window"],
  ["randomness", "Where randomness comes from"],
  ["baskets", "Stock packs"],
  ["safety", "If things go wrong"],
] as const;

export default function HowItWorks() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <h1 className="mt-6 mb-2 font-display text-4xl text-ink">How it works</h1>
      <p className="m-0 font-body text-base text-muted">
        The economics, spelled out. Ten minutes here is cheaper than one badly-backed deposit.
      </p>

      <nav aria-label="Contents" className="mt-6 flex flex-wrap gap-2">
        {TOC.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-pill border border-border bg-surface px-3 py-1.5 font-body text-xs font-semibold text-muted no-underline hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>

      <H2 id="loop">The loop</H2>
      <P>
        <Strong>Builders</Strong> wrap tokenized stocks into a pack and list it with an ERC-20 backing stake,
        creating a position. <Strong>Purchasers</Strong> pay the pool-derived price to draw one
        position at random — selection weight is <Strong>inversely proportional to backing</Strong>,
        so cheap positions come up often and heavy ones rarely. The winner then chooses:{" "}
        <Strong>keep</Strong> the item, or <Strong>sell it back</Strong> instantly for the standing
        bid. Either way the drawn position closes, and every draw's fee is shared among the
        positions still in the pool.
      </P>

      <H2 id="backing">Backing is three things at once</H2>
      <P>
        1. <Strong>A stake</Strong> — it comes back to you when you withdraw, or (minus a ~1% fee)
        when your position is drawn and kept.
      </P>
      <P>
        2. <Strong>A standing bid</Strong> — the pool holds a permanent offer, funded with your
        money, to buy the item back for <Strong>85% of your backing</Strong>. Whoever draws your
        position may exercise it. This is the single most important number you choose.
      </P>
      <P>
        3. <Strong>A rarity dial</Strong> — weight is <span className="mono">1 / backing</span>, so
        doubling the backing halves your draw odds. The pool's single highest-backed position holds
        the <Strong>Crown</Strong> and skims a tithe from every acquisition fee, paid out when it
        exits or is dethroned.
      </P>

      <H2 id="rule">The backing rule</H2>
      <P>
        The drawer always takes whichever side favors them, so the relation between your backing and
        the item's <Strong>real market value</Strong> decides your outcome before the draw ever
        happens:
      </P>
      <div className="overflow-x-auto">
        <table className="my-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left font-body text-xs tracking-wide text-muted uppercase">
              <th className="py-2 pr-4">Zone</th>
              <th className="py-2 pr-4">Condition</th>
              <th className="py-2">When drawn</th>
            </tr>
          </thead>
          <tbody className="font-body text-muted">
            <tr className="border-b border-border">
              <td className="py-3 pr-4 font-semibold whitespace-nowrap text-[#ff8585]">Sell-back trap</td>
              <td className="py-3 pr-4 whitespace-nowrap"><span className="mono">bid &gt; value</span></td>
              <td className="py-3">
                The winner returns the item and pockets your inflated bid. You lose your entire
                backing and get back an item worth less — a gift you funded.
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-3 pr-4 font-semibold whitespace-nowrap text-success">Healthy</td>
              <td className="py-3 pr-4 whitespace-nowrap"><span className="mono">value ≤ backing ≤ value ÷ 0.85</span></td>
              <td className="py-3">
                The winner keeps the item, and your exit — your backing back, minus ~1% — lands at
                market value or better. Fees earned while you waited are profit.
              </td>
            </tr>
            <tr>
              <td className="py-3 pr-4 font-semibold whitespace-nowrap text-warning">Below-market exit</td>
              <td className="py-3 pr-4 whitespace-nowrap"><span className="mono">backing &lt; value</span></td>
              <td className="py-3">
                The winner keeps an item worth more than the backing you get back — you handed over
                the difference.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <P>
        Worked example — an item worth <Strong>$31</Strong>: backing it at $99 makes the bid $84, so
        every winner sells back and you burn ~$68 per draw. Backing it at $19 means winners keep a
        $31 item for your $19 exit. The healthy band is <Strong>$31 – $36</Strong>. The deposit form
        checks this automatically when you enter a value estimate.
      </P>

      <H2 id="draw">What a draw costs — and pays</H2>
      <P>
        The price is derived from the pool itself, no oracle:{" "}
        <span className="mono">harmonic mean of all backings × (1 + surcharge)</span>. The harmonic
        mean weights cheap positions heavily — matching the fact that they are also the likeliest
        outcomes.
      </P>
      <P>
        Every draw's fee is split three ways, in order: a <Strong>protocol cut</Strong>, the{" "}
        <Strong>Crown tithe</Strong> (when the Crown is occupied), and the remainder{" "}
        <Strong>equally among all active positions</Strong>. That equal share is the yield of being
        deposited — the form previews it live as “est. earnings per draw”. When enabled by
        governance, a <Strong>dynamic extra</Strong> is added on top of the base surcharge: the more
        the pool skews toward cheap packs (arithmetic mean far above the harmonic mean), the larger
        the capped premium — composition is priced, not just the average.
      </P>

      <H2 id="settlement">The settlement window</H2>
      <P>
        Once randomness lands, the draw is <Strong>yours alone for 24 hours</Strong>: you see
        exactly which position you won and choose keep or sell-back with full information — that
        choice is a real option with real value.
      </P>
      <P>
        Let it expire and the option is gone: <Strong>anyone</Strong> may then finalize, and the
        outcome is always the fixed default (<Strong>Keep</Strong>). We deliberately chose a fixed
        default over letting the depositor settle an absent buyer's draw their way — nobody
        harvests your inaction, but nobody waits on you forever either: the depositor's capital
        unfreezes no matter what.
      </P>

      <H2 id="randomness">Where randomness comes from</H2>
      <P>
        A keeper commits the head of a <Strong>hash chain</Strong> before any draw exists; each
        draw pins a <Strong>future block</Strong> (request + 5). The random word mixes the keeper's
        pre-committed preimage with that block's hash — the keeper fixed its contribution before the
        block existed, and the block producer never knows the unrevealed preimage. Neither alone
        controls the outcome.
      </P>
      <P>
        The pool is <Strong>frozen while randomness is in flight</Strong> (freeze-at-request): no
        deposit or withdrawal can steer the selection, closing the exact hole that drained the
        original protocol. If the keeper goes silent, the request expires and{" "}
        <Strong>anyone can refund the buyer</Strong>. The randomness backend is swappable at the
        router — on HyperEVM the verifiable upgrade is Pyth Entropy (a two-party
        commit-reveal), a single adapter swap with zero pool changes.
      </P>

      <H2 id="baskets">Stock packs</H2>
      <P>
        A pack is how tokenized stocks — Tesla (TSLAon), NVIDIA (NVDAon) and SpaceX (SPCXD) — enter the pool: fungible shares wrap into an ERC-721
        whose contents are the shares you deposited; the pool escrows and delivers it like any NFT,
        and <Strong>whoever holds the basket may unwrap it</Strong> back into the underlying tokens.
        The NFT is packaging; ownership of the wrapper is ownership of the shares.
      </P>
      <P>
        The backing rule applies unchanged — the “value” of a basket is simply what its contents
        would sell for today.
      </P>

      <H2 id="safety">If things go wrong</H2>
      <P>
        <Strong>Randomness never arrives</Strong> → after the timeout, anyone expires the draw; the
        buyer is refunded, the pool unlocks. <Strong>Buyer disappears</Strong> → after the window,
        anyone finalizes the default. <Strong>A hostile NFT blocks transfer</Strong> → it is
        escrowed for later claim; the pool keeps moving. <Strong>Every payout</Strong> — earnings,
        refunds, bids, fees — accrues to a credit you withdraw yourself; settlement never pushes
        tokens to addresses that might revert.
      </P>
      <P>
        Parameters quoted here (85% bid, 24 h window, 1 h randomness timeout, surcharge and fee
        splits) are the defaults — all are on-chain and tunable, and every screen reads the live
        values.
      </P>

      <footer className="mt-12 border-t border-border pt-6">
        <a
          href="/app"
          className="rounded-pill bg-accent px-5 py-2.5 font-body text-sm font-semibold text-accent-ink no-underline shadow-accent"
        >
          Open the pool
        </a>
      </footer>
    </main>
  );
}
