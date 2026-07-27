"use client";

import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { basket } from "@/lib/contracts";
import { Erc20Abi } from "@/lib/abis";
import { fmt, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { ErrorNote, SkeletonRows } from "@/components/States";
import { BasketWrapForm } from "@/components/BasketWrapForm";

type Holding = { token: `0x${string}`; amount: bigint };
type BasketView = {
  id: bigint;
  contents: { token: string; symbol: string | undefined; amount: bigint; decimals: number }[];
};

export default function Baskets() {
  const { address, isConnected } = useAccount();
  const live = !DEMO && isConnected && !!address;

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash });

  const {
    data: count,
    isLoading: countLoading,
    isError: countError,
    refetch: refetchCount,
  } = useReadContract({
    ...basket,
    functionName: "basketCount",
    query: { enabled: live, refetchInterval: 10000 },
  });
  const n = count ? Number(count) : 0;
  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));

  // ownerOf reverts for burned (unwrapped) baskets — a per-call failure here
  // just means "not an open basket anymore", so failures are filtered, not
  // surfaced as errors.
  const { data: ownerData, isLoading: ownersLoading, refetch: refetchOwners } = useReadContracts({
    contracts: ids.map((id) => ({ ...basket, functionName: "ownerOf", args: [id] }) as const),
    query: { enabled: live && n > 0, refetchInterval: 10000 },
  });

  const mineIds = ids.filter(
    (_, i) =>
      ownerData?.[i]?.status === "success" &&
      (ownerData[i].result as string).toLowerCase() === address?.toLowerCase(),
  );

  const { data: contentsData, isLoading: contentsLoading, isError: contentsError, refetch: refetchContents } =
    useReadContracts({
      contracts: mineIds.map((id) => ({ ...basket, functionName: "contentsOf", args: [id] }) as const),
      query: { enabled: live && mineIds.length > 0, refetchInterval: 10000 },
    });

  const uniqueTokens = Array.from(
    new Set(
      (contentsData ?? [])
        .flatMap((c) => (c.result as readonly Holding[] | undefined) ?? [])
        .map((h) => h.token.toLowerCase() as `0x${string}`),
    ),
  );
  const { data: tokenMeta } = useReadContracts({
    contracts: uniqueTokens.flatMap((t) => [
      { address: t, abi: Erc20Abi, functionName: "symbol" } as const,
      { address: t, abi: Erc20Abi, functionName: "decimals" } as const,
    ]),
    query: { enabled: live && uniqueTokens.length > 0 },
  });
  const meta = (token: string) => {
    const i = uniqueTokens.indexOf(token.toLowerCase() as `0x${string}`);
    return {
      symbol: i >= 0 ? (tokenMeta?.[i * 2]?.result as string | undefined) : undefined,
      decimals: i >= 0 ? ((tokenMeta?.[i * 2 + 1]?.result as number | undefined) ?? 18) : 18,
    };
  };

  const baskets: BasketView[] = DEMO
    ? demo.baskets.map((b) => ({ id: b.id, contents: [...b.contents] }))
    : mineIds.map((id, i) => ({
        id,
        contents: (((contentsData?.[i]?.result as readonly Holding[] | undefined) ?? []) as Holding[]).map(
          (h) => ({ token: h.token, amount: h.amount, ...meta(h.token) }),
        ),
      }));

  const loading = DEMO ? false : countLoading || ownersLoading || (mineIds.length > 0 && contentsLoading);
  const failed = DEMO ? false : countError || contentsError;
  const refetch = () => {
    refetchCount();
    refetchOwners();
    refetchContents();
  };

  const busy = isPending || mining;
  const unwrap = (id: bigint) => {
    reset();
    writeContract({ ...basket, functionName: "unwrap", args: [id, address!] });
  };

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <h1 className="mt-6 mb-0 font-display text-3xl text-ink">Equity baskets</h1>
      <p className="mt-2 mb-0 font-body text-sm text-muted">
        Wrap tokenized stocks into an ERC-721 basket the pool accepts like any NFT. The basket is
        the position; unwrapping it releases the underlying shares to whoever holds it.
      </p>

      <div className="mt-8">
        <BasketWrapForm />
      </div>

      <section className="mt-8 overflow-hidden rounded-lg border border-border bg-surface shadow-sm" data-basket-list>
        <h2 className="m-0 border-b border-border px-6 py-4 font-display text-base text-ink">
          Your baskets ({baskets.length})
        </h2>
        <div className="px-6 py-5">
          {!DEMO && !isConnected ? (
            <p className="m-0 font-body text-sm text-muted">Connect a wallet to see your baskets.</p>
          ) : failed ? (
            <ErrorNote
              title="Could not load your baskets"
              detail="Reading the basket contract failed, so this list may be incomplete."
              onRetry={refetch}
            />
          ) : loading ? (
            <SkeletonRows rows={2} cols={2} />
          ) : baskets.length === 0 ? (
            <p className="m-0 font-body text-sm text-muted">
              No baskets yet — wrap some equities above to mint one.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-3 p-0">
              {baskets.map((b) => (
                <li
                  key={b.id.toString()}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-surface-2 px-4 py-3"
                  data-basket-item={b.id.toString()}
                >
                  <div>
                    <p className="m-0 font-display text-sm text-ink">Basket #{b.id.toString()}</p>
                    <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                      {b.contents.map((h) => (
                        <li key={h.token} className="font-mono text-xs text-muted">
                          {fmt(h.amount, h.decimals)}{" "}
                          <span className="text-ink">{h.symbol ?? short(h.token as `0x${string}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    className="btn"
                    disabled={busy || DEMO}
                    title={DEMO ? "Preview mode — connect to a deployed basket contract" : undefined}
                    onClick={() => unwrap(b.id)}
                  >
                    {busy ? "Confirming…" : "Unwrap"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error ? (
            <p className="field-error" role="alert">
              Transaction failed: {(error as { shortMessage?: string }).shortMessage ?? error.message}
            </p>
          ) : null}
          {mined ? <p className="notice ok" role="status">Confirmed.</p> : null}
        </div>
      </section>

      {DEMO ? (
        <p className="mt-8 mb-0 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 font-body text-xs text-muted">
          <b className="text-accent-strong">Preview with sample data.</b> Representative baskets —
          set <span className="mono">NEXT_PUBLIC_BASKET_ADDRESS</span> for live wrapping.
        </p>
      ) : null}
    </main>
  );
}
