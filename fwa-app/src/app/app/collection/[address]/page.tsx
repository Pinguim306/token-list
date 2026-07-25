"use client";

import { useParams } from "next/navigation";
import { useReadContracts } from "wagmi";
import { explorer } from "@/lib/contracts";
import { fmt, bpsToPct, short, BPS } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { usePositions, groupByCollection } from "@/lib/usePositions";
import { Erc721Abi } from "@/lib/abis";

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <p className="m-0 font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
        {label}
      </p>
      <p className={`m-0 mt-2 font-display text-2xl tabular-nums ${tone ?? "text-ink"}`}>{value}</p>
      {hint ? <p className="m-0 mt-1.5 font-body text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export default function CollectionDetail() {
  const params = useParams<{ address: string }>();
  const raw = (params?.address ?? "").toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(raw);

  const { positions, decimals, bidBps, crownId } = usePositions();
  const items = valid ? groupByCollection(positions).get(raw) ?? [] : [];

  const { data: meta } = useReadContracts({
    contracts: [
      { address: raw as `0x${string}`, abi: Erc721Abi, functionName: "name" } as const,
      { address: raw as `0x${string}`, abi: Erc721Abi, functionName: "symbol" } as const,
    ],
    query: { enabled: !DEMO && valid },
  });

  const demoMeta = demo.collections.find((c) => c.address.toLowerCase() === raw);
  const name = DEMO
    ? demoMeta?.name ?? "Unknown collection"
    : ((meta?.[0]?.result as string | undefined) ?? "Unknown collection");
  const symbol = DEMO
    ? demoMeta?.symbol ?? "—"
    : ((meta?.[1]?.result as string | undefined) ?? "—");

  if (!valid) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-20">
        <h1 className="m-0 font-display text-2xl text-ink">Invalid collection</h1>
        <p className="mt-3 mb-0 font-body text-sm text-muted">
          &ldquo;{params?.address}&rdquo; is not a contract address.
        </p>
        <a href="/app/collection" className="mt-6 inline-block font-body text-sm font-semibold text-accent-strong">
          ← All collections
        </a>
      </main>
    );
  }

  const total = items.reduce((a, p) => a + p.backing, 0n);
  const lowest = items.length ? items.reduce((m, p) => (p.backing < m ? p.backing : m), items[0].backing) : 0n;
  const highest = items.length ? items.reduce((m, p) => (p.backing > m ? p.backing : m), items[0].backing) : 0n;
  const floorBid = bidBps !== undefined && items.length ? (lowest * bidBps) / BPS : undefined;

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <a
        href="/app/collection"
        className="font-body text-sm font-semibold text-muted no-underline hover:text-ink"
      >
        ← All collections
      </a>

      <h1 className="mt-6 mb-0 font-display text-3xl text-ink">{name}</h1>
      <p className="mt-2 mb-0 font-mono text-xs text-muted">
        {symbol} ·{" "}
        {explorer && !DEMO ? (
          <a href={`${explorer}/address/${raw}`} target="_blank" rel="noreferrer">
            {short(raw)}
          </a>
        ) : (
          short(raw)
        )}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Items in pool" value={String(items.length)} />
        <Stat label="Total backing" value={fmt(total, decimals)} />
        <Stat
          label="Floor bid"
          value={floorBid !== undefined ? fmt(floorBid, decimals) : "—"}
          hint="lowest standing bid"
          tone="text-accent"
        />
        <Stat
          label="Top backing"
          value={items.length ? fmt(highest, decimals) : "—"}
          hint="rarest to draw"
          tone="text-crown"
        />
      </div>

      <h2 className="mt-12 mb-0 font-display text-xl text-ink">
        Items ({items.length})
      </h2>

      {items.length === 0 ? (
        <p className="mt-4 mb-0 font-body text-sm text-muted">
          No active positions hold this collection right now.
        </p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items
            .slice()
            .sort((a, b) => (a.backing < b.backing ? -1 : a.backing > b.backing ? 1 : 0))
            .map((p) => {
              const bid = bidBps !== undefined ? (p.backing * bidBps) / BPS : undefined;
              const isCrown = crownId !== undefined && p.id === crownId;
              return (
                <a
                  key={p.id.toString()}
                  href={`/app/position/${p.id.toString()}`}
                  className="block rounded-lg border border-border bg-surface p-5 no-underline shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="m-0 font-display text-lg text-ink">#{p.tokenId.toString()}</p>
                      <p className="m-0 mt-0.5 font-body text-xs text-muted">
                        Position #{p.id.toString()}
                      </p>
                    </div>
                    {isCrown ? (
                      <span className="rounded-pill bg-crown-soft px-2 py-0.5 font-body text-[10px] font-bold tracking-[0.1em] text-crown uppercase">
                        👑
                      </span>
                    ) : null}
                  </div>

                  <dl className="m-0 mt-4 space-y-2">
                    {[
                      ["Backing", fmt(p.backing, decimals), "text-ink"],
                      ["Standing bid", bid !== undefined ? fmt(bid, decimals) : "—", "text-accent"],
                      ["Draw odds", p.odds !== undefined ? bpsToPct(p.odds) : "—", "text-ink"],
                    ].map(([k, v, tone]) => (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <dt className="m-0 font-body text-xs text-muted">{k}</dt>
                        <dd className={`m-0 font-body text-sm tabular-nums ${tone}`}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </a>
              );
            })}
        </div>
      )}

      <p className="mt-6 mb-0 font-body text-xs text-muted">
        Sorted by backing, lightest first — which is also most-drawn first, since selection weight is
        the inverse of backing.
      </p>

      {DEMO ? (
        <p className="mt-8 mb-0 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 font-body text-xs text-muted">
          <b className="text-accent-strong">Preview with sample data.</b> Point the app at a deployed
          pool for live collections.
        </p>
      ) : null}
    </main>
  );
}
