"use client";

import { useReadContracts } from "wagmi";
import { adapter, addresses } from "@/lib/contracts";
import { fmt, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { HAS_INDEXER, useIndexerRandomness, type DataSource } from "@/lib/indexer";
import { SkeletonRows, ErrorNote, EmptyNote, SourceBadge } from "@/components/States";

const ZERO = "0x0000000000000000000000000000000000000000";
const PAGE = 25;

const STATUS_STYLE: Record<string, string> = {
  revealed: "bg-success-soft text-success",
  requested: "bg-warning-soft text-warning",
  skipped: "bg-surface-3 text-muted",
};

function when(ts: bigint) {
  if (ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
function elapsed(a: bigint, b: bigint | null) {
  if (!b || a === 0n || b < a) return null;
  const s = Number(b - a);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
function hashShort(h: string) {
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}
/** A bigint word as a short hex, matching the indexer/demo display. */
function wordShort(w: bigint | null) {
  if (w === null) return "—";
  const hex = w.toString(16).padStart(64, "0");
  return `0x${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <p className="m-0 font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
        {label}
      </p>
      <p className={`m-0 mt-2 font-display text-2xl tabular-nums ${tone ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Commit",
    body: "The keeper hashes a secret chain and publishes only its head on-chain — before any draw exists. Every future word is locked to a preimage nobody has seen.",
  },
  {
    n: "02",
    title: "Pin a future block",
    body: "Each draw fixes a seed block 5 blocks ahead. Nobody — keeper included — knows that block's hash yet, so nobody can pick the outcome.",
  },
  {
    n: "03",
    title: "Reveal & mix",
    body: "Once the seed block is history the keeper reveals the next preimage; the word is keccak256(preimage, blockhash, requestId). Neither side controls it alone.",
  },
];

export default function Randomness() {
  const hasAdapter = !DEMO && addresses.adapter !== ZERO;
  const source: DataSource = DEMO ? "demo" : HAS_INDEXER ? "indexer" : "rpc";

  // ---- live adapter state ----
  const { data: state } = useReadContracts({
    contracts: [
      { ...adapter, functionName: "chainHead" } as const,
      { ...adapter, functionName: "revealsRemaining" } as const,
      { ...adapter, functionName: "pendingRequestId" } as const,
      { ...adapter, functionName: "seedBlock" } as const,
      { ...adapter, functionName: "bond" } as const,
      { ...adapter, functionName: "slashableSkips" } as const,
    ],
    query: { enabled: hasAdapter, refetchInterval: 8000 },
  });
  const s = (i: number) => state?.[i]?.result;
  const chainHead = DEMO ? demo.randomness.chainHead : (s(0) as string | undefined);
  const revealsRemaining = DEMO ? demo.randomness.revealsRemaining : (s(1) as bigint | undefined);
  const pendingId = DEMO ? demo.randomness.pendingRequestId : (s(2) as bigint | undefined);
  const pendingSeed = DEMO ? demo.randomness.pendingSeedBlock : (s(3) as bigint | undefined);
  const bond = DEMO ? demo.randomness.bond : (s(4) as bigint | undefined);
  const skips = DEMO ? demo.randomness.slashableSkips : (s(5) as bigint | undefined);
  const idle = pendingId === undefined ? undefined : pendingId === 0n;

  // ---- request feed ----
  const indexed = useIndexerRandomness(PAGE, source === "indexer");
  const feed = DEMO
    ? demo.randomnessFeed.map((r) => ({
        id: r.id,
        seedBlock: r.seedBlock,
        status: r.status,
        wordText: r.word ?? "—",
        requestedAt: r.requestedAt,
        resolvedAt: r.resolvedAt,
      }))
    : (indexed.data?.items ?? []).map((r) => ({
        id: r.id,
        seedBlock: r.seedBlock,
        status: r.status,
        wordText: wordShort(r.randomWord),
        requestedAt: r.requestedAt,
        resolvedAt: r.resolvedAt,
      }));

  const feedLoading = source === "indexer" && indexed.isLoading;
  const feedFailed = source === "indexer" && indexed.isError;
  const showLiveState = DEMO || hasAdapter;

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-3xl text-ink">Provably fair</h1>
        <SourceBadge source={source} />
      </div>
      <p className="mt-2 mb-0 max-w-2xl font-body text-sm text-muted">
        Every draw is settled by a keeper commit-reveal hash chain mixed with a future blockhash — no
        oracle, and no way for one party to choose the outcome. Here is that machinery, live.{" "}
        <a href="/how-it-works#randomness" className="text-accent-strong">
          Full explanation →
        </a>
      </p>

      {/* how it stays fair */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {STEPS.map((st) => (
          <div key={st.n} className="rounded-lg border border-border bg-surface p-5 shadow-sm">
            <p className="m-0 font-mono text-xs text-accent">{st.n}</p>
            <h3 className="mt-1 mb-1.5 font-display text-base text-ink">{st.title}</h3>
            <p className="m-0 font-body text-[13px] leading-relaxed text-muted">{st.body}</p>
          </div>
        ))}
      </div>

      {/* live adapter state */}
      {showLiveState ? (
        <>
          <h2 className="mt-10 mb-3 font-display text-lg text-ink">Adapter state</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Status"
              value={idle === undefined ? "—" : idle ? "Idle" : "In flight"}
              tone={idle === false ? "text-warning" : "text-success"}
            />
            <Stat
              label="Reveals remaining"
              value={revealsRemaining !== undefined ? revealsRemaining.toString() : "—"}
            />
            <Stat label="Keeper bond" value={bond !== undefined ? `${fmt(bond, 18)} ETH` : "—"} />
            <Stat
              label="Recorded skips"
              value={skips !== undefined ? skips.toString() : "—"}
              tone={skips && skips > 0n ? "text-warning" : "text-ink"}
            />
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <span className="font-body text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
                Committed chain head
              </span>
              <code className="font-mono text-xs text-ink" data-chain-head>
                {chainHead ? hashShort(chainHead) : "—"}
              </code>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <span className="font-body text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
                Pending seed block
              </span>
              <code className="font-mono text-xs text-muted">
                {idle ? "— (no draw in flight)" : pendingSeed ? pendingSeed.toString() : "—"}
              </code>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-8 rounded-md border border-border bg-surface-2 px-4 py-3 font-body text-sm text-muted">
          Set <span className="mono">NEXT_PUBLIC_ADAPTER_ADDRESS</span> to show the live keeper state.
        </p>
      )}

      {/* request feed */}
      <h2 className="mt-10 mb-3 font-display text-lg text-ink">Recent randomness</h2>
      {source === "rpc" ? (
        <EmptyNote>
          The per-request history comes from the indexer. Configure{" "}
          <span className="mono">NEXT_PUBLIC_INDEXER_URL</span> to show it.
        </EmptyNote>
      ) : feedFailed ? (
        <ErrorNote
          title="Could not reach the indexer"
          detail={(indexed.error as Error | undefined)?.message ?? "The indexer did not respond."}
          onRetry={() => indexed.refetch()}
        />
      ) : feedLoading ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <SkeletonRows rows={5} cols={5} />
        </div>
      ) : feed.length === 0 ? (
        <EmptyNote>No randomness requests yet. The first draw will show up here.</EmptyNote>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <table className="w-full border-collapse" data-randomness-feed>
            <thead>
              <tr className="border-b border-border bg-surface-2">
                {["Request", "Seed block", "Status", "Word", "Latency"].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left font-body text-[11px] font-semibold tracking-[0.12em] text-muted uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {feed.map((r) => (
                <tr key={r.id.toString()} className="border-b border-border last:border-b-0">
                  <td className="px-5 py-4 font-display text-sm text-ink">#{r.id.toString()}</td>
                  <td className="px-5 py-4 font-mono text-xs text-muted">{r.seedBlock.toString()}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`rounded-pill px-2.5 py-1 font-body text-[10px] font-bold tracking-[0.1em] uppercase ${
                        STATUS_STYLE[r.status] ?? "bg-surface-3 text-muted"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-muted">{r.wordText}</td>
                  <td className="px-5 py-4 font-body text-sm tabular-nums text-muted">
                    {elapsed(r.requestedAt, r.resolvedAt) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* verify */}
      <h2 className="mt-10 mb-3 font-display text-lg text-ink">Verify a word yourself</h2>
      <div className="rounded-lg border border-border bg-surface-2 p-5">
        <p className="mt-0 mb-3 font-body text-[13px] leading-relaxed text-muted">
          Once a request is revealed, its word is fully determined by three public values — reproduce
          it and confirm nothing was tampered with:
        </p>
        <pre className="m-0 overflow-x-auto rounded-md border border-border bg-surface px-4 py-3 font-mono text-xs text-ink">
{`userSeed = keccak256(requestId, blockhash(seedBlock))
word     = keccak256(preimage, userSeed, requestId)`}
        </pre>
        <p className="mt-3 mb-0 font-body text-xs text-muted">
          The <b className="text-ink">preimage</b> is the revealed value (its keccak256 equals the
          previous chain head); <b className="text-ink">blockhash(seedBlock)</b> is the pinned future
          block. Because the head was committed before the seed block existed, neither the keeper nor
          the sequencer could have known both in advance.
        </p>
      </div>

      {DEMO ? (
        <p className="mt-8 mb-0 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 font-body text-xs text-muted">
          <b className="text-accent-strong">Preview with sample data.</b> Representative keeper state
          and requests, including one stale-skip to show the liveness path.
        </p>
      ) : null}
    </main>
  );
}
