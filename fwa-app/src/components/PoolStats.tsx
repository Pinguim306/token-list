"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { fmt, bpsToPct } from "@/lib/format";

export function PoolStats() {
  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals" });
  const dec = decimals ?? 18;

  const { data } = useReadContracts({
    contracts: [
      { ...pool, functionName: "acquisitionPrice" },
      { ...pool, functionName: "activeCount" },
      { ...pool, functionName: "drawInFlight" },
      { ...pool, functionName: "topListingId" },
      { ...pool, functionName: "topPot" },
      { ...pool, functionName: "surchargeBps" },
      { ...pool, functionName: "bidBps" },
    ],
    query: { refetchInterval: 8000 },
  });

  const price = data?.[0]?.result as bigint | undefined;
  const active = data?.[1]?.result as bigint | undefined;
  const inFlight = data?.[2]?.result as boolean | undefined;
  const topId = data?.[3]?.result as bigint | undefined;
  const topPot = data?.[4]?.result as bigint | undefined;
  const surcharge = data?.[5]?.result as bigint | undefined;
  const bid = data?.[6]?.result as bigint | undefined;

  return (
    <div className="card">
      <h2>Pool</h2>
      <div className="stat"><span>Acquisition price</span><b>{fmt(price, dec)}</b></div>
      <div className="stat"><span>Active positions</span><b>{active?.toString() ?? "—"}</b></div>
      <div className="stat"><span>Surcharge</span><b>{surcharge !== undefined ? bpsToPct(surcharge) : "—"}</b></div>
      <div className="stat"><span>Standing bid</span><b>{bid !== undefined ? bpsToPct(bid) : "—"}</b></div>
      <div className="stat">
        <span>Crown</span>
        <b>{topId && topId > 0n ? <span className="badge crown">#{topId.toString()}</span> : "vacant"}</b>
      </div>
      <div className="stat"><span>Crown pot (tithe)</span><b>{fmt(topPot, dec)}</b></div>
      <div className="stat">
        <span>Draw</span>
        <b>{inFlight ? <span className="badge warn">in flight</span> : <span className="badge">idle</span>}</b>
      </div>
    </div>
  );
}
