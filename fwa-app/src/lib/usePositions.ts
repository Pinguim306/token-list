"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { DEMO, demo } from "@/lib/demo";

export type PoolPosition = {
  id: bigint;
  depositor: `0x${string}`;
  asset: `0x${string}`;
  tokenId: bigint;
  backing: bigint;
  odds?: bigint;
};

type PositionTuple = {
  depositor: `0x${string}`;
  asset: `0x${string}`;
  tokenId: bigint;
  backing: bigint;
  weight: bigint;
  active: boolean;
  feeDebt: bigint;
};

/**
 * Every active position in the pool, plus the pool-level values screens need
 * alongside them. Shared by the pool table, the portfolio and the collection
 * pages so the read pattern (and its DEMO fallback) lives in exactly one place.
 */
export function usePositions() {
  const { data: decimals } = useReadContract({
    ...backing,
    functionName: "decimals",
    query: { enabled: !DEMO },
  });

  const {
    data: count,
    isLoading: countLoading,
    isError: countError,
    refetch: refetchCount,
  } = useReadContract({
    ...pool,
    functionName: "positionCount",
    query: { enabled: !DEMO, refetchInterval: 10000 },
  });

  const n = count ? Number(count) : 0;
  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));

  const {
    data,
    isLoading: rowsLoading,
    isError: rowsError,
    refetch: refetchRows,
  } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...pool, functionName: "positions", args: [id] } as const,
      { ...pool, functionName: "selectionOddsBps", args: [id] } as const,
    ]),
    query: { enabled: !DEMO && n > 0, refetchInterval: 10000 },
  });

  const { data: poolMeta } = useReadContracts({
    contracts: [
      { ...pool, functionName: "topListingId" } as const,
      { ...pool, functionName: "bidBps" } as const,
    ],
    query: { enabled: !DEMO, refetchInterval: 10000 },
  });

  const positions: PoolPosition[] = DEMO
    ? demo.positions.map((p) => ({
        id: p.id,
        depositor: p.depositor as `0x${string}`,
        asset: p.asset as `0x${string}`,
        tokenId: p.tokenId,
        backing: p.backing,
        odds: p.oddsBps,
      }))
    : (ids
        .map((id, i) => {
          const p = data?.[i * 2]?.result as unknown as PositionTuple | undefined;
          const odds = data?.[i * 2 + 1]?.result as bigint | undefined;
          return p && p.active
            ? { id, depositor: p.depositor, asset: p.asset, tokenId: p.tokenId, backing: p.backing, odds }
            : null;
        })
        .filter(Boolean) as PoolPosition[]);

  return {
    positions,
    decimals: DEMO ? demo.decimals : decimals ?? 18,
    crownId: DEMO ? demo.topListingId : (poolMeta?.[0]?.result as bigint | undefined),
    bidBps: DEMO ? demo.bidBps : (poolMeta?.[1]?.result as bigint | undefined),
    // Loading and error are surfaced so screens can tell "nothing here" apart
    // from "we could not find out" — collapsing them hides an RPC outage behind
    // what looks like an empty pool.
    isLoading: DEMO ? false : countLoading || (n > 0 && rowsLoading),
    isError: DEMO ? false : countError || rowsError,
    refetch: () => {
      refetchCount();
      refetchRows();
    },
  };
}

/** Demo-aware collection symbol for an asset address ("NFT" when unknown —
 *  NftArt then falls back to its default palette). */
export function collectionSymbol(asset: string): string {
  const c = demo.collections.find((c) => c.address.toLowerCase() === asset.toLowerCase());
  return c?.symbol ?? "NFT";
}

/** Group active positions by their ERC-721 contract. */
export function groupByCollection(positions: PoolPosition[]) {
  const map = new Map<string, PoolPosition[]>();
  for (const p of positions) {
    const key = p.asset.toLowerCase();
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return map;
}
