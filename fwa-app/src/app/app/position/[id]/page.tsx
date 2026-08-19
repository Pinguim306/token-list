"use client";

import { useParams } from "next/navigation";
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { fmt, bpsToPct, short, BPS } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { NftArt } from "@/components/nft/NftArt";
import { collectionSymbol } from "@/lib/usePositions";

type PositionTuple = {
  depositor: `0x${string}`;
  asset: `0x${string}`;
  tokenId: bigint;
  backing: bigint;
  weight: bigint;
  active: boolean;
  feeDebt: bigint;
};

function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: "accent" | "crown";
}) {
  const valueTone =
    tone === "accent" ? "text-accent" : tone === "crown" ? "text-crown" : "text-ink";
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <p className="m-0 font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
        {label}
      </p>
      <p
        data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
        className={`m-0 mt-2 font-display text-2xl tabular-nums ${valueTone}`}
      >
        {value}
        {unit ? <span className="ml-1.5 font-body text-sm text-muted">{unit}</span> : null}
      </p>
      {hint ? <p className="m-0 mt-1.5 font-body text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export default function PositionDetail() {
  const params = useParams<{ id: string }>();
  const raw = params?.id ?? "";
  const idNum = /^\d+$/.test(raw) ? BigInt(raw) : null;
  const valid = idNum !== null && idNum > 0n;

  const live = !DEMO && valid;

  const { data: decimals } = useReadContract({
    ...backing,
    functionName: "decimals",
    query: { enabled: live },
  });

  const { data } = useReadContracts({
    contracts: [
      { ...pool, functionName: "positions", args: [idNum ?? 0n] } as const,
      { ...pool, functionName: "selectionOddsBps", args: [idNum ?? 0n] } as const,
      { ...pool, functionName: "topListingId" } as const,
      { ...pool, functionName: "bidBps" } as const,
      { ...pool, functionName: "topBacking" } as const,
      { ...pool, functionName: "topThresholdBps" } as const,
      { ...pool, functionName: "drawInFlight" } as const,
    ],
    query: { enabled: live, refetchInterval: 8000 },
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: mining } = useWaitForTransactionReceipt({ hash: txHash });

  const dec = DEMO ? demo.decimals : decimals ?? 18;

  const demoRow = valid ? demo.positions.find((p) => p.id === idNum) : undefined;

  const position = DEMO
    ? demoRow
      ? {
          depositor: demoRow.depositor as `0x${string}`,
          tokenId: demoRow.tokenId,
          backing: demoRow.backing,
          active: true,
        }
      : undefined
    : (() => {
        const p = data?.[0]?.result as unknown as PositionTuple | undefined;
        return p ? { depositor: p.depositor, tokenId: p.tokenId, backing: p.backing, active: p.active } : undefined;
      })();

  const odds = DEMO ? demoRow?.oddsBps : (data?.[1]?.result as bigint | undefined);
  const crownId = DEMO ? demo.topListingId : (data?.[2]?.result as bigint | undefined);
  const bid = DEMO ? demo.bidBps : (data?.[3]?.result as bigint | undefined);
  const topBacking = DEMO
    ? demo.positions.find((p) => p.id === demo.topListingId)?.backing
    : (data?.[4]?.result as bigint | undefined);
  const topThresholdBps = DEMO ? 1000n : (data?.[5]?.result as bigint | undefined);
  const drawInFlight = DEMO ? demo.drawInFlight : (data?.[6]?.result as boolean | undefined) === true;

  const isCrown = crownId !== undefined && idNum !== null && crownId === idNum;
  const standingBid =
    position && bid !== undefined ? (position.backing * bid) / BPS : undefined;

  // Crown challenge: a vacant crown is claimable by any active position; an
  // occupied one needs backing >= incumbent x (1 + threshold). Mirrors the
  // contract's claimTopSpot require so nobody pays gas to learn "not enough".
  const challengeTarget =
    topBacking !== undefined && topThresholdBps !== undefined
      ? (topBacking * (BPS + topThresholdBps)) / BPS
      : undefined;
  const crownVacant = crownId !== undefined && crownId === 0n;
  const crownEligible =
    !!position &&
    position.active &&
    !isCrown &&
    !drawInFlight &&
    (crownVacant || (challengeTarget !== undefined && position.backing * BPS >= (topBacking ?? 0n) * (BPS + (topThresholdBps ?? 0n))));

  if (!valid) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-20">
        <h1 className="m-0 font-display text-2xl text-ink">Invalid position</h1>
        <p className="mt-3 mb-0 font-body text-sm text-muted">
          &ldquo;{raw}&rdquo; is not a position id. Position ids are positive whole numbers.
        </p>
        <a href="/app" className="mt-6 inline-block font-body text-sm font-semibold text-accent-strong">
          ← Back to the pool
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <a href="/app" className="font-body text-sm font-semibold text-muted no-underline hover:text-ink">
        ← Back to the pool
      </a>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {position ? (
          <div className="h-20 w-20 overflow-hidden rounded-lg border border-border-strong shadow-sm">
            <NftArt
              symbol={DEMO && demoRow ? collectionSymbol(demoRow.asset) : "NFT"}
              tokenId={position.tokenId.toString()}
              className="block h-full w-full"
            />
          </div>
        ) : null}
        <h1 className="m-0 font-display text-3xl text-ink">Position #{raw}</h1>
        {isCrown ? (
          <span className="rounded-pill bg-crown-soft px-3 py-1 font-body text-[11px] font-bold tracking-[0.12em] text-crown uppercase">
            👑 Crown
          </span>
        ) : null}
        {position && !position.active ? (
          <span className="rounded-pill bg-surface-3 px-3 py-1 font-body text-[11px] font-bold tracking-[0.12em] text-muted uppercase">
            Closed
          </span>
        ) : null}
      </div>

      {!position ? (
        <p className="mt-6 mb-0 font-body text-sm text-muted">
          {DEMO
            ? `No sample position with this id. The preview pool contains positions 1–${demo.positions.length}.`
            : "Loading position, or it does not exist in this pool."}
        </p>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Backing" value={fmt(position.backing, dec)} hint="set by the depositor" />
            <Stat
              label="Standing bid"
              value={standingBid !== undefined ? fmt(standingBid, dec) : "—"}
              hint={bid !== undefined ? `${bpsToPct(bid)} of backing` : undefined}
              tone="accent"
            />
            <Stat
              label="Draw odds"
              value={odds !== undefined ? bpsToPct(odds) : "—"}
              hint="chance per draw"
            />
            <Stat
              label="Crown"
              value={isCrown ? "Held" : "No"}
              hint={isCrown ? "earns a tithe on every fee" : "highest backing wins it"}
              tone={isCrown ? "crown" : undefined}
            />
          </div>

          {!isCrown && position.active ? (
            <section
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-5 shadow-sm"
              data-crown-challenge
            >
              <div>
                <p className="m-0 font-body text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                  Crown challenge
                </p>
                <p className="m-0 mt-1 font-body text-sm text-muted">
                  {crownVacant
                    ? "The crown is vacant — any active position may claim it."
                    : challengeTarget !== undefined
                      ? `Needs ≥ ${fmt(challengeTarget, dec)} backing to dethrone (incumbent ${fmt(topBacking ?? 0n, dec)} + ${topThresholdBps !== undefined ? bpsToPct(topThresholdBps, 0) : "—"}). This position: ${fmt(position.backing, dec)}${crownEligible ? " — eligible." : " — not enough."}`
                      : "—"}
                </p>
              </div>
              <button
                className="btn"
                disabled={DEMO || isPending || mining || !crownEligible}
                title={
                  DEMO
                    ? "Preview mode"
                    : drawInFlight
                      ? "Pool frozen while a draw is in flight"
                      : !crownEligible
                        ? "Backing does not meet the challenge threshold"
                        : "Claim the crown for this position"
                }
                onClick={() => writeContract({ ...pool, functionName: "claimTopSpot", args: [idNum!] })}
              >
                {isPending || mining ? "Confirming…" : "Claim crown"}
              </button>
            </section>
          ) : null}

          <section className="mt-10 rounded-lg border border-border bg-surface p-6 shadow-sm">
            <h2 className="m-0 font-display text-base text-ink">If this position is drawn</h2>
            <ol className="m-0 mt-4 list-none space-y-3 p-0">
              <li className="flex gap-3">
                <span className="font-display text-sm text-border-strong">01</span>
                <p className="m-0 font-body text-sm leading-relaxed text-muted">
                  The purchaser has already paid the pool-derived acquisition price — the harmonic
                  mean of every active backing, plus the surcharge.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="font-display text-sm text-border-strong">02</span>
                <p className="m-0 font-body text-sm leading-relaxed text-muted">
                  They keep NFT <span className="font-mono text-ink">#{position.tokenId.toString()}</span>,
                  and this position closes.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="font-display text-sm text-border-strong">03</span>
                <p className="m-0 font-body text-sm leading-relaxed text-muted">
                  Or they sell it straight back for the standing bid of{" "}
                  <span className="text-ink">
                    {standingBid !== undefined ? fmt(standingBid, dec) : "—"}
                  </span>
                  , which the depositor&apos;s backing funds.
                </p>
              </li>
            </ol>
          </section>

          <section className="mt-4 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <h2 className="m-0 border-b border-border px-6 py-4 font-display text-base text-ink">
              On-chain detail
            </h2>
            <dl className="m-0 divide-y divide-border">
              {[
                ["Depositor", short(position.depositor), position.depositor],
                ["NFT token id", `#${position.tokenId.toString()}`, null],
                ["Weight", "1e36 ÷ backing", "inverse of backing"],
                ["Status", position.active ? "Active" : "Closed", null],
              ].map(([k, v, title]) => (
                <div key={k as string} className="flex items-center justify-between gap-4 px-6 py-4">
                  <dt className="m-0 font-body text-sm text-muted">{k}</dt>
                  <dd
                    className="m-0 font-mono text-sm text-ink"
                    title={(title as string) ?? undefined}
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}

      {DEMO ? (
        <p className="mt-8 mb-0 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 font-body text-xs text-muted">
          <b className="text-accent-strong">Preview with sample data.</b> Point the app at a deployed
          pool (<span className="font-mono">NEXT_PUBLIC_POOL_ADDRESS</span>) for live values.
        </p>
      ) : null}
    </main>
  );
}
