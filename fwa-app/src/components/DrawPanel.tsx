"use client";

import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { maxUint256 } from "viem";
import { pool, backing } from "@/lib/contracts";
import { DRAW_STATE, fmt, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";

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
    ],
    query: { refetchInterval: 5000, enabled: !DEMO },
  });
  const drawCount = DEMO ? demo.draw.drawId : (data?.[0]?.result as bigint | undefined);
  const inFlight = DEMO ? demo.drawInFlight : (data?.[1]?.result as boolean | undefined);

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

  return (
    <div className="card feature">
      <h2><span className="ic">◈</span> Draw</h2>

      <div className={`gacha${requested ? " inflight" : ""}`}>
        <div className="ring"><span>Ξ</span></div>
        <div className="state">{stateName}</div>
        <div className="sub">
          {fulfilled ? `Position #${d?.selectedId?.toString()} selected — keep it or sell it back`
            : requested ? "Randomness in flight — pool frozen"
            : "Pay the pool price to acquire a random position"}
        </div>
      </div>

      {d && <div className="stat"><span>Buyer</span><b className="mono">{short(d.buyer)}</b></div>}
      {d && <div className="stat"><span>Escrowed price</span><b>{fmt(d.price, dec)}</b></div>}
      {hasDraw && <div className="stat"><span>Draw #</span><b>{drawCount!.toString()}</b></div>}

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={busy || inFlight}
          onClick={() => writeContract({ ...pool, functionName: "startDraw", args: [maxUint256] })}>
          Start draw
        </button>
        <button className="btn" disabled={busy || !fulfilled || (!isBuyer && !DEMO)}
          onClick={() => writeContract({ ...pool, functionName: "settle", args: [drawCount!, 0] })}>
          Keep NFT
        </button>
        <button className="btn" disabled={busy || !fulfilled || (!isBuyer && !DEMO)}
          onClick={() => writeContract({ ...pool, functionName: "settle", args: [drawCount!, 1] })}>
          Sell back
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn ghost" disabled={busy || !fulfilled}
          onClick={() => writeContract({ ...pool, functionName: "finalize", args: [drawCount!] })}>
          Finalize
        </button>
        <button className="btn ghost" disabled={busy || !requested}
          onClick={() => writeContract({ ...pool, functionName: "expireDraw", args: [drawCount!] })}>
          Expire · refund
        </button>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Randomness settles via Chainlink VRF over CCIP. While “Requested”, the pool is frozen (freeze-at-request);
        once “Fulfilled”, the buyer keeps the NFT or sells it back for the standing bid.
      </p>
    </div>
  );
}
