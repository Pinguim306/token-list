"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { maxUint256 } from "viem";
import { pool, backing } from "@/lib/contracts";
import { DRAW_STATE, fmt, fmtDuration, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { collectionSymbol } from "@/lib/usePositions";
import { RipReveal, type RipSelected } from "@/components/RipReveal";

type Draw = {
  buyer: `0x${string}`; price: bigint; totalWeightSnapshot: bigint; randomWord: bigint;
  requestedAt: bigint; fulfilledAt: bigint; selectedId: bigint; state: number;
};

export function DrawPanel() {
  const { address } = useAccount();
  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals", query: { enabled: !DEMO } });
  const dec = DEMO ? demo.decimals : decimals ?? 18;

  const { data } = useReadContracts({
    contracts: [
      { ...pool, functionName: "drawCount" },
      { ...pool, functionName: "drawInFlight" },
      { ...pool, functionName: "settlementWindow" },
      { ...pool, functionName: "requestTimeout" },
    ],
    query: { refetchInterval: 5000, enabled: !DEMO },
  });
  const drawCount = DEMO ? demo.draw.drawId : (data?.[0]?.result as bigint | undefined);
  const inFlight = DEMO ? demo.drawInFlight : (data?.[1]?.result as boolean | undefined);
  const settlementWindow = DEMO ? demo.settlementWindow : ((data?.[2]?.result as bigint | undefined) ?? 86_400n);
  const requestTimeout = DEMO ? demo.requestTimeout : ((data?.[3]?.result as bigint | undefined) ?? 3_600n);

  const hasDraw = !!drawCount && drawCount > 0n;
  const { data: draw } = useReadContract({
    ...pool, functionName: "draws", args: hasDraw ? [drawCount!] : undefined,
    query: { enabled: !DEMO && hasDraw, refetchInterval: 5000 },
  });
  const d: Draw | undefined = DEMO
    ? ({ buyer: demo.draw.buyer as `0x${string}`, price: demo.draw.price, totalWeightSnapshot: 0n, randomWord: 0n, requestedAt: 0n, fulfilledAt: 0n, selectedId: BigInt(demo.draw.selectedId), state: demo.draw.state } as Draw)
    : (draw as unknown as Draw | undefined);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: mining } = useWaitForTransactionReceipt({ hash });
  const busy = isPending || mining || DEMO;

  const stateName = d ? DRAW_STATE[d.state] ?? "Idle" : "Idle";
  const isBuyer = !!d && !!address && d.buyer.toLowerCase() === address.toLowerCase();
  const fulfilled = d?.state === 2;
  const requested = d?.state === 1;

  // A 1s clock, started client-side only so SSR markup never contains a
  // wall-clock value (hydration would mismatch). Until the first tick the
  // deadline UI simply doesn't render.
  const [nowMs, setNowMs] = useState<number | null>(null);
  // Demo anchor: pretend the draw was fulfilled 14 minutes ago, so the
  // countdown reads "23h 46m" — the number from the settlement-window lesson.
  const demoAnchor = useRef<number>(0);
  useEffect(() => {
    demoAnchor.current = Date.now() - 14 * 60_000;
    const tick = () => setNowMs(Date.now());
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  const fulfilledAtMs = DEMO ? demoAnchor.current : d ? Number(d.fulfilledAt) * 1000 : 0;
  const requestedAtMs = DEMO ? demoAnchor.current : d ? Number(d.requestedAt) * 1000 : 0;
  const settleDeadline = fulfilledAtMs + Number(settlementWindow) * 1000;
  const expireDeadline = requestedAtMs + Number(requestTimeout) * 1000;
  // Pre-hydration (nowMs null) nothing is considered expired.
  const windowClosed = fulfilled && nowMs !== null && nowMs > settleDeadline;
  const randomnessOverdue = requested && nowMs !== null && nowMs > expireDeadline;

  const deadline =
    nowMs === null
      ? null
      : fulfilled
        ? windowClosed
          ? { tone: "late", text: "Settlement window closed — anyone can finalize the default outcome (Keep)." }
          : {
              tone: settleDeadline - nowMs < 3_600_000 ? "warn" : "ok",
              text: `${isBuyer ? "Yours alone" : "Buyer's call"} for ${fmtDuration(settleDeadline - nowMs)} — after that, anyone can finalize (default: Keep).`,
            }
        : requested
          ? randomnessOverdue
            ? { tone: "late", text: "Randomness overdue — anyone can expire the draw and refund the buyer." }
            : {
                tone: "ok",
                text: `Randomness due within ${fmtDuration(expireDeadline - nowMs)} — the keeper answers on its own clock.`,
              }
          : null;

  // The revealed card needs the selected position's collection + tokenId.
  const { data: selPos } = useReadContract({
    ...pool,
    functionName: "positions",
    args: fulfilled && d ? [d.selectedId] : undefined,
    query: { enabled: !DEMO && fulfilled },
  });
  const selected: RipSelected | undefined = DEMO
    ? (() => {
        const p = demo.positions.find((p) => p.id === BigInt(demo.draw.selectedId));
        return p
          ? { positionId: p.id.toString(), symbol: collectionSymbol(p.asset), tokenId: p.tokenId.toString() }
          : undefined;
      })()
    : selPos && d
      ? (() => {
          // positions(id) tuple: [depositor, asset, tokenId, backing, weight, active, feeDebt]
          const t = selPos as unknown as [string, string, bigint, bigint, bigint, boolean, bigint];
          return { positionId: d.selectedId.toString(), symbol: collectionSymbol(t[1]), tokenId: t[2].toString() };
        })()
      : undefined;

  return (
    <div className="card feature">
      <h2><span className="ic">◈</span> Rip a pack <span className="badge hot" style={{ marginLeft: 8 }}>{stateName}</span></h2>

      <RipReveal
        demo={DEMO}
        state={fulfilled ? "fulfilled" : requested ? "requested" : "idle"}
        selected={selected}
      />

      {deadline ? (
        <p className={`deadline ${deadline.tone}`} data-draw-deadline role="status">
          <span className="deadline-clock" aria-hidden="true">◷</span>
          {deadline.text}
        </p>
      ) : null}

      {d && <div className="stat"><span>Buyer</span><b className="mono">{short(d.buyer)}</b></div>}
      {d && <div className="stat"><span>Escrowed price</span><b>{fmt(d.price, dec)}</b></div>}
      {hasDraw && <div className="stat"><span>Draw #</span><b>{drawCount!.toString()}</b></div>}

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={busy || inFlight}
          onClick={() => writeContract({ ...pool, functionName: "startDraw", args: [maxUint256] })}>
          Rip a pack
        </button>
        <button className="btn" disabled={busy || !fulfilled || windowClosed || (!isBuyer && !DEMO)}
          onClick={() => writeContract({ ...pool, functionName: "settle", args: [drawCount!, 0] })}>
          Keep the pack
        </button>
        <button className="btn" disabled={busy || !fulfilled || windowClosed || (!isBuyer && !DEMO)}
          onClick={() => writeContract({ ...pool, functionName: "settle", args: [drawCount!, 1] })}>
          Sell back
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {/* Contract-mirrored gating: finalize only opens once the settlement
            window has passed, expire only once randomness is overdue — the
            user should never pay gas to learn "too early". */}
        <button className="btn ghost" disabled={busy || !fulfilled || !windowClosed}
          title={fulfilled && !windowClosed ? "Opens when the settlement window closes" : undefined}
          onClick={() => writeContract({ ...pool, functionName: "finalize", args: [drawCount!] })}>
          Finalize
        </button>
        <button className="btn ghost" disabled={busy || !requested || !randomnessOverdue}
          title={requested && !randomnessOverdue ? "Opens if randomness misses its deadline" : undefined}
          onClick={() => writeContract({ ...pool, functionName: "expireDraw", args: [drawCount!] })}>
          Expire · refund
        </button>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Randomness mixes a keeper commit-reveal chain with a future blockhash (VRF-upgradable at the
        router). While “Requested”, the pool is frozen (freeze-at-request); once “Fulfilled”, the
        buyer keeps the pack or sells it back for the standing bid.
      </p>
    </div>
  );
}
