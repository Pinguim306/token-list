"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { fmt, bpsToPct } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";

export function PoolStats() {
  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals", query: { enabled: !DEMO } });
  const dec = DEMO ? demo.decimals : decimals ?? 18;

  const { data } = useReadContracts({
    contracts: [
      { ...pool, functionName: "acquisitionPrice" },
      { ...pool, functionName: "activeCount" },
      { ...pool, functionName: "drawInFlight" },
      { ...pool, functionName: "topListingId" },
      { ...pool, functionName: "topPot" },
      { ...pool, functionName: "surchargeBps" },
      { ...pool, functionName: "bidBps" },
      { ...pool, functionName: "weightedBackingTotal" },
      { ...pool, functionName: "totalWeight" },
    ],
    query: { refetchInterval: 8000, enabled: !DEMO },
  });

  const price = DEMO ? demo.price : (data?.[0]?.result as bigint | undefined);
  const active = DEMO ? demo.activeCount : (data?.[1]?.result as bigint | undefined);
  const inFlight = DEMO ? demo.drawInFlight : (data?.[2]?.result as boolean | undefined);
  const topId = DEMO ? demo.topListingId : (data?.[3]?.result as bigint | undefined);
  const topPot = DEMO ? demo.topPot : (data?.[4]?.result as bigint | undefined);
  const surcharge = DEMO ? demo.surchargeBps : (data?.[5]?.result as bigint | undefined);
  const bid = DEMO ? demo.bidBps : (data?.[6]?.result as bigint | undefined);

  // Live dynamic-pricing extra: read from the chain (dynamicExtraBps needs the
  // current EV = weightedBackingTotal / totalWeight). Demo pool is uniform, so
  // the extra is 0 there. Shown only when the feature is actually adding to
  // the price, so buyers can see composition being priced.
  const wbt = data?.[7]?.result as bigint | undefined;
  const tw = data?.[8]?.result as bigint | undefined;
  const evForExtra = wbt !== undefined && tw && tw > 0n ? wbt / tw : undefined;
  const { data: dynExtra } = useReadContract({
    ...pool,
    functionName: "dynamicExtraBps",
    args: evForExtra !== undefined ? [evForExtra] : undefined,
    query: { enabled: !DEMO && evForExtra !== undefined, refetchInterval: 8000 },
  });
  const dynamicExtra = DEMO ? 0n : (dynExtra as bigint | undefined);

  return (
    <div className="card">
      <h2>Pool</h2>
      <div className="stat"><span>Acquisition price</span><b>{fmt(price, dec)}</b></div>
      <div className="stat"><span>Active positions</span><b>{active?.toString() ?? "—"}</b></div>
      <div className="stat"><span>Surcharge</span><b>{surcharge !== undefined ? bpsToPct(surcharge) : "—"}</b></div>
      {dynamicExtra !== undefined && dynamicExtra > 0n ? (
        <div className="stat" title="Extra surcharge because the pool skews toward cheap packs — composition is priced, not just the average.">
          <span>Cheap-pack premium</span>
          <b className="badge hot">+{bpsToPct(dynamicExtra)}</b>
        </div>
      ) : null}
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
