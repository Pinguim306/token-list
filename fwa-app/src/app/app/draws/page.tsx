"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { DRAW_STATE, fmt, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";

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
  state: number;
  requestedAt: bigint;
  fulfilledAt: bigint;
};

/** Newest first, capped — a pool with thousands of draws should not fan out
 *  thousands of eth_calls just to render a first page. */
const PAGE = 25;

const STATE_STYLE: Record<number, string> = {
  1: "bg-warning-soft text-warning", // Requested — randomness in flight
  2: "bg-accent-soft text-accent-strong", // Fulfilled — awaiting settlement
  3: "bg-success-soft text-success", // Settled
  4: "bg-surface-3 text-muted", // Refunded
};

function when(ts: bigint) {
  if (ts === 0n) return "—";
  const d = new Date(Number(ts) * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function elapsed(a: bigint, b: bigint) {
  if (a === 0n || b === 0n || b < a) return null;
  const s = Number(b - a);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function DrawsHistory() {
  const { data: decimals } = useReadContract({
    ...backing,
    functionName: "decimals",
    query: { enabled: !DEMO },
  });

  const { data: count } = useReadContract({
    ...pool,
    functionName: "drawCount",
    query: { enabled: !DEMO, refetchInterval: 10000 },
  });

  const total = count ? Number(count) : 0;
  const ids = Array.from({ length: Math.min(total, PAGE) }, (_, i) => BigInt(total - i));

  const { data } = useReadContracts({
    contracts: ids.map((id) => ({ ...pool, functionName: "draws", args: [id] }) as const),
    query: { enabled: !DEMO && total > 0, refetchInterval: 10000 },
  });

  const dec = DEMO ? demo.decimals : decimals ?? 18;

  const rows: Row[] = DEMO
    ? demo.drawHistory.map((d) => ({
        id: d.id,
        buyer: d.buyer as `0x${string}`,
        price: d.price,
        selectedId: d.selectedId,
        state: d.state,
        requestedAt: d.requestedAt,
        fulfilledAt: d.fulfilledAt,
      }))
    : (ids
        .map((id, i) => {
          const d = data?.[i]?.result as unknown as DrawTuple | undefined;
          return d
            ? {
                id,
                buyer: d.buyer,
                price: d.price,
                selectedId: d.selectedId,
                state: d.state,
                requestedAt: d.requestedAt,
                fulfilledAt: d.fulfilledAt,
              }
            : null;
        })
        .filter(Boolean) as Row[]);

  const settled = rows.filter((r) => r.state === 3).length;
  const refunded = rows.filter((r) => r.state === 4).length;

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <h1 className="mt-6 mb-0 font-display text-3xl text-ink">Draw history</h1>
      <p className="mt-2 mb-0 max-w-2xl font-body text-sm text-muted">
        Every acquisition attempt. A draw freezes the selection set at request time, so the position
        it lands on is fixed before the random word ever arrives.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 mb-0 font-body text-sm text-muted">No draws yet.</p>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
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
                {rows.map((r) => {
                  const lat = elapsed(r.requestedAt, r.fulfilledAt);
                  return (
                    <tr key={r.id.toString()} className="border-b border-border last:border-b-0">
                      <td className="px-5 py-4 font-display text-sm text-ink">#{r.id.toString()}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-pill px-2.5 py-1 font-body text-[10px] font-bold tracking-[0.1em] uppercase ${
                            STATE_STYLE[r.state] ?? "bg-surface-3 text-muted"
                          }`}
                        >
                          {DRAW_STATE[r.state] ?? "Unknown"}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-muted">{short(r.buyer)}</td>
                      <td className="px-5 py-4 font-body text-sm tabular-nums text-ink">
                        {fmt(r.price, dec)}
                      </td>
                      <td className="px-5 py-4 font-body text-sm">
                        {r.selectedId > 0n ? (
                          <a
                            href={`/app/position/${r.selectedId.toString()}`}
                            className="text-accent-strong"
                          >
                            #{r.selectedId.toString()}
                          </a>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-muted">{when(r.requestedAt)}</td>
                      <td className="px-5 py-4 font-body text-sm tabular-nums text-muted">
                        {lat ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!DEMO && total > rows.length ? (
            <p className="mt-3 mb-0 font-body text-xs text-muted">
              Showing the {rows.length} most recent of {total} draws.
            </p>
          ) : null}

          <p className="mt-4 mb-0 font-body text-xs text-muted">
            <b className="text-ink">Latency</b> is request → randomness callback. A refunded draw is
            one where randomness never arrived and anyone expired it, returning the purchaser&apos;s
            payment — the pool cannot wedge on a missing callback.
          </p>
        </>
      )}

      {DEMO ? (
        <p className="mt-8 mb-0 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 font-body text-xs text-muted">
          <b className="text-accent-strong">Preview with sample data.</b> Representative draws,
          including a refunded one to show the liveness path.
        </p>
      ) : null}
    </main>
  );
}
