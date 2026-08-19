"use client";

import { usePositions } from "@/lib/usePositions";
import { fmt, DRAW_STATE } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { HAS_INDEXER, useIndexerDraws, type DataSource } from "@/lib/indexer";
import { SourceBadge, ErrorNote, SkeletonRows, EmptyNote } from "@/components/States";
import { BarChart, LineChart, OutcomeBar, type Bar, type Point, type Segment } from "@/components/analytics/Charts";

const PAGE = 50;

function Kpi({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <p className="m-0 font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className={`m-0 mt-2 font-display text-2xl tabular-nums ${tone ?? "text-ink"}`}>
        {value}
        {unit ? <span className="ml-1.5 font-body text-sm text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <h2 className="m-0 font-display text-base text-ink">{title}</h2>
        {hint ? <p className="m-0 mt-0.5 font-body text-xs text-muted">{hint}</p> : null}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

export default function Analytics() {
  const { positions, decimals: dec, crownId, isLoading: posLoading, isError: posError, refetch } = usePositions();

  const source: DataSource = DEMO ? "demo" : HAS_INDEXER ? "indexer" : "rpc";
  const indexed = useIndexerDraws(PAGE, source === "indexer");

  // ---- draws (demo | indexer) ----
  type D = { id: bigint; price: bigint; stateName: string; requestedAt: bigint };
  const draws: D[] = DEMO
    ? demo.drawHistory.map((d) => ({ id: d.id, price: d.price, stateName: DRAW_STATE[d.state] ?? "Unknown", requestedAt: d.requestedAt }))
    : (indexed.data?.items ?? []).map((d) => ({ id: d.id, price: d.price, stateName: d.state, requestedAt: d.requestedAt }));

  const drawsLoading = source === "indexer" && indexed.isLoading;
  const drawsFailed = source === "indexer" && indexed.isError;

  // ---- derived series ----
  const totalBacking = positions.reduce((a, p) => a + p.backing, 0n);
  const settled = draws.filter((d) => d.stateName === "Settled").length;
  const refunded = draws.filter((d) => d.stateName === "Refunded").length;
  const fulfilled = draws.filter((d) => d.stateName === "Fulfilled" || d.stateName === "Requested").length;

  // Backing by position, heaviest first; the Crown gets the emphasis color.
  // Ties break by id so the order is identical in every JS engine — an
  // inconsistent comparator would let SSR and the client sort ties differently
  // and mismatch on hydration.
  const backingBars: Bar[] = [...positions]
    .sort((a, b) => (b.backing > a.backing ? 1 : b.backing < a.backing ? -1 : Number(a.id - b.id)))
    .slice(0, 8)
    .map((p) => ({
      label: `#${p.id.toString()}`,
      value: Number(fmt(p.backing, dec).replace(/,/g, "")),
      display: fmt(p.backing, dec),
      emphasis: crownId !== undefined && p.id === crownId,
      sub: crownId !== undefined && p.id === crownId ? "Crown" : undefined,
    }));

  // Acquisition price across draw history, oldest → newest.
  const priceLine: Point[] = [...draws]
    .sort((a, b) => (a.id > b.id ? 1 : -1))
    .map((d) => ({ label: `Draw #${d.id.toString()}`, value: Number(fmt(d.price, dec).replace(/,/g, "")), display: fmt(d.price, dec) }));

  const outcomes: Segment[] = [
    { label: "Settled", value: settled, color: "var(--success)" },
    { label: "In flight", value: fulfilled, color: "var(--accent)" },
    { label: "Refunded", value: refunded, color: "var(--muted)" },
  ];

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-3xl text-ink">Pool analytics</h1>
        <SourceBadge source={source} />
      </div>
      <p className="mt-2 mb-0 max-w-2xl font-body text-sm text-muted">
        Where the liquidity sits, what draws have cost, and how they resolved. Backing concentration
        drives the draw odds; the acquisition price is the harmonic mean of every active backing.
      </p>

      {/* KPI row */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Backing at work" value={fmt(totalBacking, dec)} />
        <Kpi label="Active positions" value={String(positions.length)} />
        <Kpi label="Draws settled" value={String(settled)} tone="text-success" />
        <Kpi label="Acquisition price" value={DEMO ? fmt(demo.price, dec) : draws[0] ? fmt(draws[0].price, dec) : "—"} tone="text-accent" />
      </div>

      {posError ? (
        <div className="mt-8">
          <ErrorNote title="Could not load positions" detail="Reading the pool failed." onRetry={refetch} />
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card title="Backing by position" hint="Heaviest first — heavy positions are drawn rarely. The Crown is highlighted.">
            {posLoading ? (
              <SkeletonRows rows={5} cols={2} />
            ) : backingBars.length === 0 ? (
              <EmptyNote>No active positions yet.</EmptyNote>
            ) : (
              <BarChart data={backingBars} ariaLabel="Backing amount by position, heaviest first" />
            )}
          </Card>

          <Card title="Draw outcomes" hint="Kept, sold back, or refunded when randomness timed out.">
            {drawsFailed ? (
              <ErrorNote title="Could not reach the indexer" detail="Draw history is unavailable." onRetry={() => indexed.refetch()} />
            ) : drawsLoading ? (
              <SkeletonRows rows={2} cols={3} />
            ) : draws.length === 0 ? (
              <EmptyNote>No draws yet.</EmptyNote>
            ) : (
              <OutcomeBar data={outcomes} ariaLabel={`Draw outcomes: ${settled} settled, ${fulfilled} in flight, ${refunded} refunded`} />
            )}
          </Card>

          <Card title="Acquisition price" hint="Harmonic mean of backings × surcharge, per draw over time.">
            {drawsFailed ? (
              <ErrorNote title="Could not reach the indexer" detail="Price history is unavailable." onRetry={() => indexed.refetch()} />
            ) : drawsLoading ? (
              <SkeletonRows rows={4} cols={2} />
            ) : priceLine.length < 2 ? (
              <EmptyNote>Not enough draws yet to chart a price trend.</EmptyNote>
            ) : (
              <LineChart data={priceLine} ariaLabel="Acquisition price per draw over time" />
            )}
          </Card>

          <Card title="Concentration" hint="How much of the pool's backing the top positions hold.">
            {posLoading ? (
              <SkeletonRows rows={3} cols={2} />
            ) : positions.length === 0 ? (
              <EmptyNote>No active positions yet.</EmptyNote>
            ) : (
              <Concentration totalBacking={totalBacking} positions={positions} dec={dec} />
            )}
          </Card>
        </div>
      )}

      {source === "rpc" ? (
        <p className="mt-8 mb-0 rounded-md border border-border bg-surface-2 px-4 py-3 font-body text-xs text-muted">
          Draw-based charts read from the indexer. Set <span className="mono">NEXT_PUBLIC_INDEXER_URL</span> for full history.
        </p>
      ) : null}
      {DEMO ? (
        <p className="mt-4 mb-0 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 font-body text-xs text-muted">
          <b className="text-accent-strong">Preview with sample data.</b> Representative pool figures — connect to a deployed pool for live analytics.
        </p>
      ) : null}
    </main>
  );
}

/** Top-N share of total backing as a labelled meter — the "how concentrated" read. */
function Concentration({
  totalBacking,
  positions,
  dec,
}: {
  totalBacking: bigint;
  positions: { id: bigint; backing: bigint }[];
  dec: number;
}) {
  // Same consistent comparator as the backing chart — see the note there.
  const sorted = [...positions].sort((a, b) => (b.backing > a.backing ? 1 : b.backing < a.backing ? -1 : Number(a.id - b.id)));
  const topN = Math.min(3, sorted.length);
  const topSum = sorted.slice(0, topN).reduce((a, p) => a + p.backing, 0n);
  const pct = totalBacking > 0n ? Number((topSum * 10000n) / totalBacking) / 100 : 0;
  return (
    <div>
      <p className="m-0 font-display text-4xl tabular-nums text-ink">
        {pct.toFixed(1)}
        <span className="ml-1 font-body text-lg text-muted">%</span>
      </p>
      <p className="m-0 mt-1 font-body text-sm text-muted">
        of all backing is held by the top {topN} {topN === 1 ? "position" : "positions"} ({fmt(topSum, dec)} of {fmt(totalBacking, dec)}).
      </p>
      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Top ${topN} positions hold ${pct.toFixed(1)} percent of backing`}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
