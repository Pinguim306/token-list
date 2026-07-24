"use client";

import { useState } from "react";
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { emitter, addresses } from "@/lib/contracts";
import { fmt } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";

export function RewardsPanel() {
  const { address } = useAccount();
  const hasEmitter = DEMO || addresses.emitter !== "0x0000000000000000000000000000000000000000";

  const { data } = useReadContracts({
    contracts: [
      { ...emitter, functionName: "rewardCredit", args: address ? [address] : undefined },
      { ...emitter, functionName: "currentDay" },
      { ...emitter, functionName: "purchaserBudget" },
    ],
    query: { enabled: !DEMO && hasEmitter, refetchInterval: 8000 },
  });
  const credit = DEMO ? demo.reward : (data?.[0]?.result as bigint | undefined);
  const day = DEMO ? demo.currentDay : (data?.[1]?.result as bigint | undefined);
  const budget = DEMO ? demo.purchaserBudget : (data?.[2]?.result as bigint | undefined);

  const [claimDayInput, setClaimDayInput] = useState("");
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: mining } = useWaitForTransactionReceipt({ hash });
  const busy = isPending || mining || DEMO;

  if (!hasEmitter) {
    return (
      <div className="card">
        <h2>$FWA rewards</h2>
        <p className="muted">No emitter configured (set NEXT_PUBLIC_EMITTER).</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>$FWA rewards</h2>
      <div className="stat"><span>Claimable $FWA</span><b>{fmt(credit)}</b></div>
      <div className="stat"><span>Current day</span><b>{day?.toString() ?? "—"}</b></div>
      <div className="stat"><span>Purchaser budget left</span><b>{fmt(budget)}</b></div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={busy || !credit}
          onClick={() => writeContract({ ...emitter, functionName: "claim" })}>
          Claim $FWA
        </button>
      </div>
      <label>Claim a closed day&apos;s purchaser pot</label>
      <div className="row">
        <input value={claimDayInput} onChange={(e) => setClaimDayInput(e.target.value)} placeholder="0" style={{ maxWidth: 120 }} />
        <button className="btn" disabled={busy || !address || claimDayInput === ""}
          onClick={() => writeContract({ ...emitter, functionName: "claimDay", args: [BigInt(claimDayInput || "0"), address!] })}>
          Claim day pot
        </button>
      </div>
      <p className="muted">Depositor emissions accrue on √backing; purchasers share each day&apos;s pot pro-rata, claimable once the day closes.</p>
    </div>
  );
}
