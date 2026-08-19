"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { DRAW_STATE, fmt, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { HAS_INDEXER, useIndexerDraws, type DataSource } from "@/lib/indexer";
import { SkeletonRows, ErrorNote, EmptyNote, SourceBadge } from "@/components/States";

type DrawTuple = {
  buyer: `0x${string}`;
  price: bigint;
  totalWeightSnapshot: bigint;
  randomWord: bigint;
  requestedAt: bigint;
  fulfilledAt: bigint;
  selectedId: bigint;
  state: number;
};

type Row = {
  id: bigint;
  buyer: `0x${string}`;
  price: bigint;
  selectedId: bigint;
  stateName: string;
  requestedAt: bigint;
  resolvedAt: bigint;
};

/** Cap for the RPC path — one eth_call per draw does not scale to a long history.
 *  The indexer path is paginated server-side and has no such constraint. */
const PAGE = 25;

const STATE_STYLE: Record<string, string> = {
  Requested: "bg-warning-soft text-warning",
  Fulfilled: "bg-accent-soft text-accent-strong",
  Settled: "bg-success-soft text-success",
  Refunded: "bg-surface-3 text-muted",
};

function when(ts: bigint) {
  if (ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function elapsed(a: bigint, b: bigint) {
  if (a === 0n || b === 0n || b < a) return null;
  const s = Number(b - a);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function DrawsHistory() {
  const source: DataSource = DEMO ? "demo" : HAS_INDEXER ? "indexer" : "rpc";
  const useRpc = source === "rpc";

  // ---- indexer path ----
  const indexed = useIndexerDraws(PAGE, source === "indexer");

  // ---- RPC fallback path ----
  const { data: decimals } = useReadContract({
    ...backing,
    functionName: "decimals",
    query: { enabled: !DEMO },
  });

  const { data: count, isLoading: countLoading } = useReadContract({
    ...pool,
    functionName: "drawCount",
    query: { enabled: useRpc, refetchInterval: 10000 },
  });

  const total = count ? Number(count) : 0;
  const ids = Array.from({ length: Math.min(total, PAGE) }, (_, i) => BigInt(total - i));

  const { data, isLoading: rowsLoading } = useReadContracts({
    contracts: ids.map((id) => ({ ...pool, functionName: "draws", args: [id] }) as const),
    query: { enabled: useRpc && total > 0, refetchInterval: 10000 },
  });

  const dec = DEMO ? demo.decimals : decimals ?? 18;

  let rows: Row[] = [];
  if (source === "demo") {
    rows = demo.drawHistory.map((d) => ({
      id: d.id,
      buyer: d.buyer as `0x${string}`,
      price: d.price,
      selectedId: d.selectedId,
      stateName: DRAW_STATE[d.state] ?? "Unknown",
      requestedAt: d.requestedAt,
      resolvedAt: d.fulfilledAt,
    }));
  } else if (source === "indexer") {
    rows = (indexed.data?.items ?? []).map((d) => ({
      id: d.id,
      buyer: d.buyer,
      price: d.price,
      selectedId: d.selectedId ?? 0n,
      stateName: d.state,
      requestedAt: d.requestedAt,
      resolvedAt: d.resolvedAt ?? 0n,
    }));
  } else {
    rows = ids
      .map((id, i) => {
        const d = data?.[i]?.result as unknown as DrawTuple | undefined;
        return d
          ? {
              id,
              buyer: d.buyer,
              price: d.price,
              selectedId: d.selectedId,
              stateName: DRAW_STATE[d.state] ?? "Unknown",
              requestedAt: d.requestedAt,
              resolvedAt: d.fulfilledAt,
            }
          : null;
      })
      .filter(Boolean) as Row[];
  }

  const loading =
    source === "indexer" ? indexed.isLoading : useRpc ? countLoading || (total > 0 && rowsLoading) : false;
  const failed = source === "indexer" && indexed.isError;

  const settled = rows.filter((r) => r.stateName === "Settled").length;
  const refunded = rows.filter((r) => r.stateName === "Refunded").length;
  const shownOf = source === "indexer" ? indexed.data?.totalCount ?? rows.length : total;

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-3xl text-ink">Draw history</h1>
        <SourceBadge source={source} />
      </div>
      <p className="mt-2 mb-0 max-w-2xl font-body text-sm text-muted">
        Every acquisition attempt. A draw freezes the selection set at request time, so the position
        it lands on is fixed before the random word ever arrives.
      </p>

      <div className="mt-8">
        {failed ? (
          <ErrorNote
            title="Could not reach the indexer"
            detail={
              (indexed.error as Error | undefined)?.message ??
              "The indexer did not respond. History is unavailable until it recovers."
            }
            onRetry={() => indexed.refetch()}
          />
        ) : loading ? (
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <SkeletonRows rows={5} cols={6} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyNote>No draws yet. The first acquisition will show up here.</EmptyNote>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Shown", String(rows.length), null],
                ["Settled", String(settled), "text-success"],
                ["Refunded", String(refunded), "text-muted"],
              ].map(([k, v, tone]) => (
                <div key={k as string} className="rounded-lg border border-border bg-surface p-5 shadow-sm">
                  <p className="m-0 font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                    {k}
                  </p>
                  <p className={`m-0 mt-2 font-display text-2xl tabular-nums ${tone ?? "text-ink"}`}>{v}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    {["Draw", "State", "Buyer", "Price", "Position", "Requested", "Latency"].map((h) => (
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
                  {rows.map((r) => (
                    <tr key={r.id.toString()} className="border-b border-border last:border-b-0">
                      <td className="px-5 py-4 font-display text-sm text-ink">#{r.id.toString()}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-pill px-2.5 py-1 font-body text-[10px] font-bold tracking-[0.1em] uppercase ${
                            STATE_STYLE[r.stateName] ?? "bg-surface-3 text-muted"
                          }`}
                        >
                          {r.stateName}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-muted">{short(r.buyer)}</td>
                      <td className="px-5 py-4 font-body text-sm tabular-nums text-ink">
                        {fmt(r.price, dec)}
                      </td>
                      <td className="px-5 py-4 font-body text-sm">
                        {r.selectedId > 0n ? (
                          <a href={`/app/position/${r.selectedId.toString()}`} className="text-accent-strong">
                            #{r.selectedId.toString()}
                          </a>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-muted">{when(r.requestedAt)}</td>
                      <td className="px-5 py-4 font-body text-sm tabular-nums text-muted">
                        {elapsed(r.requestedAt, r.resolvedAt) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {shownOf > rows.length ? (
              <p className="mt-3 mb-0 font-body text-xs text-muted">
                Showing the {rows.length} most recent of {shownOf} draws.
                {useRpc ? " Configure an indexer to page through the full history." : null}
              </p>
            ) : null}

            <p className="mt-4 mb-0 font-body text-xs text-muted">
              <b className="text-ink">Latency</b> is request → randomness callback. A refunded draw is
              one where randomness never arrived and anyone expired it, returning the purchaser&apos;s
              payment — the pool cannot wedge on a missing callback.
            </p>
          </>
        )}
      </div>

    </main>
  );
}
