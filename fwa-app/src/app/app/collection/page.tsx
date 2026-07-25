"use client";

import { useReadContracts } from "wagmi";
import { nft } from "@/lib/contracts";
import { fmt, short, BPS } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { usePositions, groupByCollection } from "@/lib/usePositions";
import { Erc721Abi } from "@/lib/abis";

export default function CollectionIndex() {
  const { positions, decimals, bidBps, crownId } = usePositions();
  const groups = groupByCollection(positions);
  const assets = Array.from(groups.keys());

  // name/symbol for every collection present in the pool
  const { data: meta } = useReadContracts({
    contracts: assets.flatMap((a) => [
      { address: a as `0x${string}`, abi: Erc721Abi, functionName: "name" } as const,
      { address: a as `0x${string}`, abi: Erc721Abi, functionName: "symbol" } as const,
    ]),
    query: { enabled: !DEMO && assets.length > 0 },
  });

  const labelFor = (asset: string, i: number) => {
    if (DEMO) {
      const c = demo.collections.find((c) => c.address.toLowerCase() === asset);
      return { name: c?.name ?? "Unknown collection", symbol: c?.symbol ?? "—" };
    }
    return {
      name: (meta?.[i * 2]?.result as string | undefined) ?? "Unknown collection",
      symbol: (meta?.[i * 2 + 1]?.result as string | undefined) ?? "—",
    };
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <h1 className="mt-6 mb-0 font-display text-3xl text-ink">Collections</h1>
      <p className="mt-2 mb-0 max-w-2xl font-body text-sm text-muted">
        The pool is collection-agnostic — each position carries its own ERC-721 contract, so more
        than one whitelisted collection can sit in the same pool.
      </p>

      {assets.length === 0 ? (
        <p className="mt-8 mb-0 font-body text-sm text-muted">
          No active positions yet, so no collections are represented in the pool.
        </p>
      ) : (
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {assets.map((asset, i) => {
            const items = groups.get(asset)!;
            const { name, symbol } = labelFor(asset, i);
            const total = items.reduce((a, p) => a + p.backing, 0n);
            const lowest = items.reduce((m, p) => (p.backing < m ? p.backing : m), items[0].backing);
            const floorBid = bidBps !== undefined ? (lowest * bidBps) / BPS : undefined;
            const hasCrown =
              crownId !== undefined && items.some((p) => p.id === crownId);

            return (
              <a
                key={asset}
                href={`/app/collection/${asset}`}
                className="block rounded-lg border border-border bg-surface p-6 no-underline shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="m-0 font-display text-lg text-ink">{name}</h2>
                  {hasCrown ? (
                    <span className="rounded-pill bg-crown-soft px-2.5 py-1 font-body text-[10px] font-bold tracking-[0.12em] text-crown uppercase">
                      👑 Crown
                    </span>
                  ) : null}
                </div>
                <p className="m-0 mt-1 font-mono text-xs text-muted">
                  {symbol} · {short(asset)}
                </p>

                <dl className="m-0 mt-5 grid grid-cols-3 gap-4">
                  {[
                    ["Items", String(items.length)],
                    ["Backing", fmt(total, decimals)],
                    ["Floor bid", floorBid !== undefined ? fmt(floorBid, decimals) : "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="m-0 font-body text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
                        {k}
                      </dt>
                      <dd className="m-0 mt-1 font-display text-lg tabular-nums text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              </a>
            );
          })}
        </div>
      )}

      {DEMO ? (
        <p className="mt-8 mb-0 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 font-body text-xs text-muted">
          <b className="text-accent-strong">Preview with sample data.</b> Two sample collections are
          shown to illustrate that one pool can hold several.
        </p>
      ) : null}
    </main>
  );
}
