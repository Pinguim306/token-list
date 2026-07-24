import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fake World Assets — Randomized on-chain NFT acquisition",
  description:
    "Deposit an NFT with a backing stake, or acquire a position at random. Selection weight is inversely proportional to backing — on RobinhoodChain.",
};

/* Note: this app does NOT load Tailwind's Preflight (see globals.css), so element
   defaults are not reset. Margins/list styles are zeroed explicitly below. */

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#mechanic", label: "Mechanics" },
  { href: "#security", label: "Security" },
  { href: "#faq", label: "FAQ" },
];

const STATS = [
  { k: "Total backing", v: "—", u: "USDG" },
  { k: "Active positions", v: "—", u: "" },
  { k: "Draws settled", v: "—", u: "" },
  { k: "$FWA emitted", v: "—", u: "" },
];

const STEPS = [
  {
    n: "01",
    role: "Depositor",
    title: "Deposit",
    body: "Lock an NFT plus an ERC-20 backing stake to open a position. The backing you choose is your standing bid — the price you are willing to buy the NFT back for.",
    icon: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2.5" />
        <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
        <path d="M12 12v4M10 14h4" />
      </>
    ),
  },
  {
    n: "02",
    role: "Purchaser",
    title: "Draw",
    body: "Pay the pool-derived price — the harmonic mean of all backings, plus a surcharge — and one position is selected at random by verifiable randomness.",
    icon: (
      <>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        <circle cx="12" cy="12" r="3.5" />
      </>
    ),
  },
  {
    n: "03",
    role: "Purchaser",
    title: "Decide",
    body: "Keep the NFT, or sell it straight back for the depositor's standing bid at 85%. Either way the depositor's position closes and settles.",
    icon: (
      <>
        <path d="M4 7h10l-2.5-3M20 17H10l2.5 3" />
        <path d="M4 7l2.5 3M20 17l-2.5-3" />
      </>
    ),
  },
];

/* weight = 1e36 / backing → relative weight is 1/backing, normalised to the
   lightest position. These are illustrative, not live pool figures. */
const POSITIONS = [
  { backing: 1, label: "Lightly backed" },
  { backing: 4, label: "Mid backed" },
  { backing: 16, label: "Heavily backed" },
];
const maxWeight = 1 / POSITIONS[0].backing;
const maxBacking = POSITIONS[POSITIONS.length - 1].backing;

const SECURITY = [
  {
    title: "Freeze-at-request",
    primary: true,
    body: "When a draw starts, payment is escrowed and the selection set is frozen. No deposit or withdrawal can change which positions are eligible while randomness is in flight — closing the exact gap that drained the original protocol.",
  },
  {
    title: "Pull-based payouts",
    body: "Every outgoing value — earnings, refunds, sell-back proceeds, fees — accrues to a credit balance the recipient withdraws themselves. Settlement never pushes tokens.",
  },
  {
    title: "Non-reverting delivery",
    body: "A hostile or paused NFT contract cannot brick a draw. If transfer fails, the NFT is escrowed for later claim and the pool keeps moving.",
  },
  {
    title: "Serialized draws",
    body: "Exactly one draw is in flight at a time, and stuck states always resolve: unfulfilled draws expire and refund, and anyone can finalize a stale one.",
  },
];

const FAQ = [
  {
    q: "Why would I back a position heavily?",
    a: "Backing sets your standing bid and your rarity. A heavily-backed position is drawn rarely, so it keeps earning fees while it sits in the pool — and when it is finally drawn, the purchaser pays a lot to take it.",
  },
  {
    q: "What exactly do I get when I purchase?",
    a: "One position, chosen at random by weight. You then choose to keep the NFT or sell it back for 85% of that position's standing bid. You see which position you drew before the settlement step completes.",
  },
  {
    q: "How is the price determined?",
    a: "It is derived from the pool itself: the harmonic mean of every active position's backing, plus a configurable surcharge. No oracle sets it.",
  },
  {
    q: "What is the Crown?",
    a: "The single highest-backed position holds the Crown and accrues a tithe from every acquisition fee. The accumulated tithe pays out when that position exits or is dethroned by a larger backer — exactly once, never twice.",
  },
  {
    q: "Where does randomness come from?",
    a: "It is abstracted behind a router with swappable adapters, so the pool never depends on one provider. The callback only stores the random word — it never selects or transfers, and it cannot revert the pool.",
  },
  {
    q: "What happens if randomness never arrives?",
    a: "After a timeout anyone can expire the draw, which refunds the purchaser and unlocks the pool. Liveness never depends on the buyer or the operator showing up.",
  },
];

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border py-20 sm:py-28">
      <p className="m-0 font-body text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-4 mb-0 font-display text-3xl leading-[1.05] text-ink sm:text-4xl">
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 mb-0 max-w-2xl font-body text-base text-muted sm:text-lg">{lead}</p>
      ) : null}
      <div className="mt-10">{children}</div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg font-body text-ink">
      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-50 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a href="/landing" className="flex items-center gap-2.5 no-underline">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-ink font-display text-[13px] leading-none text-accent-ink shadow-sm">
              F<span className="text-accent">W</span>A
            </span>
            <span className="hidden font-display text-sm text-ink sm:block">Fake World Assets</span>
          </a>

          <nav className="hidden items-center gap-7 md:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="font-body text-sm font-medium text-muted no-underline transition-colors hover:text-ink focus-visible:text-ink"
              >
                {n.label}
              </a>
            ))}
          </nav>

          <a
            href="/"
            className="rounded-pill bg-accent px-4 py-2 font-body text-sm font-semibold text-accent-ink no-underline shadow-accent transition-transform hover:scale-[1.03] motion-reduce:transform-none"
          >
            Launch App
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        {/* ---------- hero ---------- */}
        <section className="py-20 sm:py-28">
          <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1.5 font-body text-xs font-semibold tracking-wide text-muted uppercase shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-pill bg-success opacity-70 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-pill bg-success" />
            </span>
            Live on RobinhoodChain testnet
          </span>

          <h1 className="mt-7 mb-0 max-w-4xl font-display text-[clamp(2.5rem,7vw,5.25rem)] leading-[0.96] tracking-tight text-ink">
            Real stakes.
            <br />
            <span className="text-accent">Fake world</span>
            <br />
            assets.
          </h1>

          <p className="mt-7 mb-0 max-w-xl font-body text-lg text-muted">
            Acquire a randomly selected NFT position backed by a depositor-funded standing bid — or
            provide the backing and earn from every draw.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="/"
              className="rounded-pill bg-accent px-6 py-3 font-body text-sm font-semibold text-accent-ink no-underline shadow-accent transition-transform hover:scale-[1.03] motion-reduce:transform-none"
            >
              Launch App
            </a>
            <a
              href="#how"
              className="rounded-pill border border-border-strong bg-surface px-6 py-3 font-body text-sm font-semibold text-ink no-underline transition-colors hover:bg-surface-2"
            >
              How it works
            </a>
          </div>

          <dl className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.k} className="bg-surface px-5 py-6">
                <dt className="m-0 font-body text-xs font-semibold tracking-wide text-muted uppercase">
                  {s.k}
                </dt>
                <dd className="m-0 mt-2 font-display text-2xl tabular-nums text-ink">
                  {s.v}
                  {s.u ? <span className="ml-1.5 font-body text-sm text-muted">{s.u}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ---------- how it works ---------- */}
        <Section
          id="how"
          eyebrow="How it works"
          title="Deposit. Draw. Decide."
          lead="Two roles, one pool. Depositors set the terms; purchasers take the chance."
        >
          <div className="grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <article
                key={s.n}
                className="rounded-lg border border-border bg-surface p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="grid h-11 w-11 place-items-center rounded-md bg-accent-soft text-accent"
                    aria-hidden="true"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {s.icon}
                    </svg>
                  </span>
                  <span className="font-display text-sm text-border-strong">{s.n}</span>
                </div>
                <p className="m-0 mt-5 font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                  {s.role}
                </p>
                <h3 className="mt-1.5 mb-0 font-display text-xl text-ink">{s.title}</h3>
                <p className="m-0 mt-3 font-body text-sm leading-relaxed text-muted">{s.body}</p>
              </article>
            ))}
          </div>
        </Section>

        {/* ---------- inverse weight ---------- */}
        <Section
          id="mechanic"
          eyebrow="The core mechanic"
          title="Backing buys rarity, not odds."
          lead="Selection weight is 1e36 ÷ backing. Back a position lightly and it gets drawn constantly for a small reward. Back it heavily and it becomes rare — but valuable."
        >
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <div className="hidden grid-cols-[1fr_2fr_2fr] gap-6 border-b border-border bg-surface-2 px-6 py-3 sm:grid">
              {["Position", "Chance of being drawn", "Payout if drawn"].map((h) => (
                <span
                  key={h}
                  className="font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase"
                >
                  {h}
                </span>
              ))}
            </div>

            {POSITIONS.map((p) => {
              const weightPct = (1 / p.backing / maxWeight) * 100;
              const payoutPct = (p.backing / maxBacking) * 100;
              return (
                <div
                  key={p.backing}
                  className="grid gap-4 border-b border-border px-6 py-6 last:border-b-0 sm:grid-cols-[1fr_2fr_2fr] sm:items-center sm:gap-6"
                >
                  <div>
                    <p className="m-0 font-display text-lg tabular-nums text-ink">
                      {p.backing} <span className="font-body text-sm text-muted">USDG</span>
                    </p>
                    <p className="m-0 mt-1 font-body text-xs text-muted">{p.label}</p>
                  </div>

                  <div>
                    <div className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-3">
                      <div
                        className="h-full rounded-pill bg-accent"
                        style={{ width: `${weightPct}%` }}
                      />
                    </div>
                    <p className="m-0 mt-2 font-body text-xs tabular-nums text-muted">
                      {weightPct.toFixed(2)}% relative weight
                    </p>
                  </div>

                  <div>
                    <div className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-3">
                      <div
                        className="h-full rounded-pill bg-crown"
                        style={{ width: `${payoutPct}%` }}
                      />
                    </div>
                    <p className="m-0 mt-2 font-body text-xs tabular-nums text-muted">
                      {p.backing} USDG standing bid
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-2 p-6">
              <h3 className="m-0 font-display text-base text-ink">Pool-derived price</h3>
              <p className="m-0 mt-2 font-body text-sm leading-relaxed text-muted">
                The acquisition price is the harmonic mean of every active backing plus a surcharge —
                so a pool full of cheap positions stays cheap to play, and one heavy position cannot
                drag the price up on its own.
              </p>
            </div>
            <div className="rounded-lg border border-crown/40 bg-crown-soft p-6">
              <h3 className="m-0 font-display text-base text-ink">The Crown</h3>
              <p className="m-0 mt-2 font-body text-sm leading-relaxed text-muted">
                The highest-backed position wears the Crown and takes a tithe of every acquisition
                fee. It pays out exactly once — when that position exits, or when a bigger backer
                dethrones it.
              </p>
            </div>
          </div>
        </Section>

        {/* ---------- security ---------- */}
        <Section
          id="security"
          eyebrow="Security"
          title="Built to not get drained."
          lead="The original protocol was drained when state changed between the randomness request and its callback. That class of attack is designed out here."
        >
          <div className="grid gap-5 md:grid-cols-2">
            {SECURITY.map((s) => (
              <article
                key={s.title}
                className={
                  s.primary
                    ? "rounded-lg border border-accent/40 bg-accent-soft p-6"
                    : "rounded-lg border border-border bg-surface p-6 shadow-sm"
                }
              >
                <div className="flex items-center gap-2.5">
                  <h3 className="m-0 font-display text-base text-ink">{s.title}</h3>
                  {s.primary ? (
                    <span className="rounded-pill bg-accent px-2 py-0.5 font-body text-[10px] font-bold tracking-wide text-accent-ink uppercase">
                      Primary defence
                    </span>
                  ) : null}
                </div>
                <p className="m-0 mt-3 font-body text-sm leading-relaxed text-muted">{s.body}</p>
              </article>
            ))}
          </div>
        </Section>

        {/* ---------- faq ---------- */}
        <Section id="faq" eyebrow="FAQ" title="Questions worth asking.">
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            {FAQ.map((f) => (
              <details key={f.q} className="group border-b border-border last:border-b-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 font-body text-base font-semibold text-ink transition-colors hover:bg-surface-2">
                  {f.q}
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-45 motion-reduce:transition-none"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p className="m-0 px-6 pb-5 font-body text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>
      </main>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-14 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-ink font-display text-sm leading-none text-accent-ink">
              F<span className="text-accent">W</span>A
            </span>
            <p className="m-0 mt-4 font-body text-sm text-muted">
              Randomized on-chain asset acquisition on RobinhoodChain. Nothing here is investment
              advice.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {[
              { h: "Protocol", l: ["Launch App", "How it works", "Security"] },
              { h: "Developers", l: ["Contracts", "Audit package", "Indexer"] },
              { h: "Project", l: ["Brand", "Roadmap", "Changelog"] },
            ].map((col) => (
              <div key={col.h}>
                <p className="m-0 font-body text-[11px] font-semibold tracking-[0.14em] text-ink uppercase">
                  {col.h}
                </p>
                <ul className="m-0 mt-3 list-none space-y-2 p-0">
                  {col.l.map((item) => (
                    <li key={item}>
                      <span className="font-body text-sm text-muted">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
