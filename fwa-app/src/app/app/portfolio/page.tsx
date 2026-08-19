"use client";

import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { pool, backing, emitter } from "@/lib/contracts";
import { fmt, bpsToPct, short, BPS } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { ErrorNote, SkeletonRows } from "@/components/States";
import { StuckNftClaim } from "@/components/StuckNftClaim";

type PositionTuple = {
  depositor: `0x${string}`;
  asset: `0x${string}`;
  tokenId: bigint;
  backing: bigint;
  weight: bigint;
  active: boolean;
  feeDebt: bigint;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <h2 className="m-0 border-b border-border px-6 py-4 font-display text-base text-ink">{title}</h2>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function Money({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div>
      <p className="m-0 font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
        {label}
      </p>
      <p className={`m-0 mt-1.5 font-display text-2xl tabular-nums ${tone ?? "text-ink"}`}>
        {value}
        {unit ? <span className="ml-1.5 font-body text-sm text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}

export default function Portfolio() {
  const { address, isConnected } = useAccount();
  const live = !DEMO && isConnected && !!address;

  const { data: decimals } = useReadContract({
    ...backing,
    functionName: "decimals",
    query: { enabled: !DEMO },
  });
  const dec = DEMO ? demo.decimals : decimals ?? 18;

  const {
    data: count,
    isLoading: countLoading,
    isError: countError,
    refetch: refetchCount,
  } = useReadContract({
    ...pool,
    functionName: "positionCount",
    query: { enabled: live, refetchInterval: 10000 },
  });
  const n = count ? Number(count) : 0;
  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));

  const {
    data: rowData,
    isLoading: rowsLoading,
    isError: rowsError,
    refetch: refetchRows,
  } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...pool, functionName: "positions", args: [id] } as const,
      { ...pool, functionName: "selectionOddsBps", args: [id] } as const,
    ]),
    query: { enabled: live && n > 0, refetchInterval: 10000 },
  });

  const { data: balances } = useReadContracts({
    contracts: [
      { ...pool, functionName: "backingCredit", args: [address ?? "0x0"] } as const,
      { ...pool, functionName: "bidBps" } as const,
      // rewardCredit is keyed by account; the emitter's pendingOf takes a
      // positionId, not an address — different thing entirely.
      { ...emitter, functionName: "rewardCredit", args: [address ?? "0x0"] } as const,
      { ...pool, functionName: "drawInFlight" } as const,
    ],
    query: { enabled: live, refetchInterval: 10000 },
  });

  const { writeContract, data: txHash, isPending, error: txError, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || mining || DEMO;

  const mine = DEMO
    ? demo.positions
        .filter((p) => p.id === 1n || p.id === 4n) // sample: two positions owned
        .map((p) => ({ id: p.id, tokenId: p.tokenId, backing: p.backing, odds: p.oddsBps }))
    : (ids
        .map((id, i) => {
          const p = rowData?.[i * 2]?.result as unknown as PositionTuple | undefined;
          const odds = rowData?.[i * 2 + 1]?.result as bigint | undefined;
          const isMine = p && p.active && address && p.depositor.toLowerCase() === address.toLowerCase();
          return isMine ? { id, tokenId: p!.tokenId, backing: p!.backing, odds } : null;
        })
        .filter(Boolean) as { id: bigint; tokenId: bigint; backing: bigint; odds: bigint | undefined }[]);

  // "no positions" and "the read failed" are different facts — keep them apart.
  const loading = DEMO ? false : countLoading || (n > 0 && rowsLoading);
  const failed = DEMO ? false : countError || rowsError;
  const refetch = () => {
    refetchCount();
    refetchRows();
  };

  const credit = DEMO ? demo.credit : (balances?.[0]?.result as bigint | undefined);
  const bid = DEMO ? demo.bidBps : (balances?.[1]?.result as bigint | undefined);
  const reward = DEMO ? demo.reward : (balances?.[2]?.result as bigint | undefined);
  const drawInFlight = DEMO ? demo.drawInFlight : (balances?.[3]?.result as boolean | undefined) === true;

  // Pending $FWA emissions per owned position (harvest realizes them into
  // rewardCredit without closing the position).
  const { data: pendingData } = useReadContracts({
    contracts: mine.map((p) => ({ ...emitter, functionName: "pendingOf", args: [p.id] }) as const),
    query: { enabled: live && mine.length > 0, refetchInterval: 10000 },
  });
  const pendingOf = (id: bigint, i: number): bigint | undefined =>
    DEMO ? demo.pendingEmissions.get(id) ?? 0n : (pendingData?.[i]?.result as bigint | undefined);

  const totalBacking = mine.reduce((a, p) => a + p.backing, 0n);
  const totalExposure = bid !== undefined ? (totalBacking * bid) / BPS : undefined;

  if (!DEMO && !isConnected) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-20">
        <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
          ← Back to the pool
        </a>
        <h1 className="mt-6 mb-0 font-display text-3xl text-ink">Your portfolio</h1>
        <p className="mt-4 mb-0 font-body text-base text-muted">
          Connect a wallet to see the positions you back, your withdrawable credit, and your $FWA
          rewards.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <h1 className="mt-6 mb-0 font-display text-3xl text-ink">Your portfolio</h1>
      <p className="mt-2 mb-0 font-body text-sm text-muted">
        {short(address)} · {mine.length} open{" "}
        {mine.length === 1 ? "position" : "positions"}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <Money label="Backing at work" value={fmt(totalBacking, dec)} />
        </div>
        <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <Money
            label="Sell-back exposure"
            value={totalExposure !== undefined ? fmt(totalExposure, dec) : "—"}
            tone="text-accent"
          />
        </div>
        <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <Money
            label="Withdrawable credit"
            value={credit !== undefined ? fmt(credit, dec) : "—"}
            tone="text-success"
          />
        </div>
        <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <Money label="$FWA claimable" value={reward !== undefined ? fmt(reward, 18) : "—"} />
        </div>
      </div>

      <p className="mt-3 mb-0 font-body text-xs text-muted">
        Sell-back exposure is what you would pay out if every one of your positions were drawn and
        sold back at the standing bid ({bid !== undefined ? bpsToPct(bid) : "—"} of backing).
      </p>

      <div className="mt-8">
        <Card title={`Your positions (${mine.length})`}>
          {failed ? (
            <ErrorNote
              title="Could not load your positions"
              detail="Reading the pool failed, so this list may be incomplete."
              onRetry={refetch}
            />
          ) : loading ? (
            <SkeletonRows rows={2} cols={3} />
          ) : mine.length === 0 ? (
            <p className="m-0 font-body text-sm text-muted">
              You have no open positions. Deposit an NFT plus backing from the pool page to open one.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-3 p-0">
              {mine.map((p, i) => {
                const pending = pendingOf(p.id, i);
                return (
                <li
                  key={p.id.toString()}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-surface-2 px-4 py-3"
                  data-portfolio-position={p.id.toString()}
                >
                  <div>
                    <a
                      href={`/app/position/${p.id.toString()}`}
                      className="font-display text-sm text-ink no-underline hover:text-accent-strong"
                    >
                      Position #{p.id.toString()}
                    </a>
                    <p className="m-0 mt-0.5 font-mono text-xs text-muted">
                      NFT #{p.tokenId.toString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="text-right">
                      <p className="m-0 font-body text-[10px] tracking-wide text-muted uppercase">
                        Backing
                      </p>
                      <p className="m-0 font-body text-sm tabular-nums text-ink">
                        {fmt(p.backing, dec)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="m-0 font-body text-[10px] tracking-wide text-muted uppercase">
                        Draw odds
                      </p>
                      <p className="m-0 font-body text-sm tabular-nums text-accent">
                        {p.odds !== undefined ? bpsToPct(p.odds) : "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="m-0 font-body text-[10px] tracking-wide text-muted uppercase">
                        Pending $FWA
                      </p>
                      <p className="m-0 font-body text-sm tabular-nums text-ink">
                        {pending !== undefined ? fmt(pending, 18) : "—"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn"
                        disabled={busy || !pending}
                        title="Realize this position's pending $FWA without closing it"
                        onClick={() => {
                          reset();
                          writeContract({ ...emitter, functionName: "harvest", args: [p.id] });
                        }}
                      >
                        Harvest
                      </button>
                      <button
                        className="btn"
                        disabled={busy || drawInFlight}
                        title={
                          drawInFlight
                              ? "A draw is in flight — the pool is frozen until it settles"
                              : "Close this position: NFT + backing + earnings come back to you"
                        }
                        onClick={() => {
                          reset();
                          writeContract({ ...pool, functionName: "withdraw", args: [p.id] });
                        }}
                      >
                        Withdraw
                      </button>
                    </div>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {txError ? (
        <p className="mt-4 field-error" role="alert">
          Transaction failed: {(txError as { shortMessage?: string }).shortMessage ?? txError.message}
        </p>
      ) : null}
      {mined ? <p className="mt-4 notice ok" role="status">Confirmed.</p> : null}
      {drawInFlight ? (
        <p className="mt-4 mb-0 rounded-md border border-warning bg-warning-soft px-4 py-3 font-body text-xs text-muted" role="status">
          A draw is in flight — withdrawals are paused until it settles (freeze-at-request).
        </p>
      ) : null}

      <div className="mt-8">
        <StuckNftClaim />
      </div>

    </main>
  );
}
