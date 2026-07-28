"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Optional Ponder indexer. When `NEXT_PUBLIC_INDEXER_URL` points at a running
 * `fwa-indexer`, history comes from indexed events; otherwise screens fall back
 * to reading the pool directly over RPC. The indexer is an accelerator, never a
 * requirement — the app must work against a bare chain.
 */
export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "").replace(/\/$/, "");
export const HAS_INDEXER = INDEXER_URL !== "";

export type DataSource = "demo" | "indexer" | "rpc";

export type IndexedDraw = {
  id: bigint;
  buyer: `0x${string}`;
  price: bigint;
  state: string;
  selectedId: bigint | null;
  choice: number | null;
  requestedAt: bigint;
  resolvedAt: bigint | null;
};

class IndexerError extends Error {}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${INDEXER_URL}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new IndexerError(`Indexer returned HTTP ${res.status}`);

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new IndexerError(json.errors[0].message);
  if (!json.data) throw new IndexerError("Indexer returned no data");
  return json.data;
}

/** `null` and `undefined` stay null; everything else must parse as a bigint. */
function toBig(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  return BigInt(v as string | number);
}

const DRAWS_QUERY = `
  query Draws($limit: Int!) {
    draws(orderBy: "id", orderDirection: "desc", limit: $limit) {
      items {
        id
        buyer
        price
        state
        selectedId
        choice
        requestedAt
        resolvedAt
      }
      totalCount
    }
  }
`;

type DrawsResponse = {
  draws: {
    items: Array<Record<string, unknown>>;
    totalCount?: number;
  };
};

export function useIndexerDraws(limit: number, enabled: boolean) {
  return useQuery({
    queryKey: ["indexer", "draws", limit],
    enabled: enabled && HAS_INDEXER,
    refetchInterval: 10_000,
    retry: 1,
    queryFn: async () => {
      const data = await gql<DrawsResponse>(DRAWS_QUERY, { limit });
      const items: IndexedDraw[] = (data.draws?.items ?? []).map((d) => ({
        id: BigInt(d.id as string),
        buyer: d.buyer as `0x${string}`,
        price: BigInt(d.price as string),
        state: String(d.state),
        selectedId: toBig(d.selectedId),
        choice: d.choice === null || d.choice === undefined ? null : Number(d.choice),
        requestedAt: BigInt(d.requestedAt as string),
        resolvedAt: toBig(d.resolvedAt),
      }));
      return { items, totalCount: data.draws?.totalCount ?? items.length };
    },
  });
}

export type IndexedRandomness = {
  id: bigint;
  seedBlock: bigint;
  status: string; // requested | revealed | skipped
  randomWord: bigint | null;
  requestedAt: bigint;
  resolvedAt: bigint | null;
};

const RANDOMNESS_QUERY = `
  query Randomness($limit: Int!) {
    randomnessRequests(orderBy: "id", orderDirection: "desc", limit: $limit) {
      items {
        id
        seedBlock
        status
        randomWord
        requestedAt
        resolvedAt
      }
      totalCount
    }
  }
`;

type RandomnessResponse = {
  randomnessRequests: { items: Array<Record<string, unknown>>; totalCount?: number };
};

export function useIndexerRandomness(limit: number, enabled: boolean) {
  return useQuery({
    queryKey: ["indexer", "randomness", limit],
    enabled: enabled && HAS_INDEXER,
    refetchInterval: 10_000,
    retry: 1,
    queryFn: async () => {
      const data = await gql<RandomnessResponse>(RANDOMNESS_QUERY, { limit });
      const items: IndexedRandomness[] = (data.randomnessRequests?.items ?? []).map((r) => ({
        id: BigInt(r.id as string),
        seedBlock: BigInt(r.seedBlock as string),
        status: String(r.status),
        randomWord: toBig(r.randomWord),
        requestedAt: BigInt(r.requestedAt as string),
        resolvedAt: toBig(r.resolvedAt),
      }));
      return { items, totalCount: data.randomnessRequests?.totalCount ?? items.length };
    },
  });
}
