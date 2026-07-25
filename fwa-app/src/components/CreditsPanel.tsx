"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { parseInteger } from "@/lib/parse";
import { fmt } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";

export function CreditsPanel() {
  const { address } = useAccount();
  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals", query: { enabled: !DEMO } });
  const dec = DEMO ? demo.decimals : decimals ?? 18;
  const { data: creditData } = useReadContract({
    ...pool,
    functionName: "backingCredit",
    args: address ? [address] : undefined,
    query: { enabled: !DEMO && !!address, refetchInterval: 8000 },
  });
  const credit = DEMO ? demo.credit : (creditData as bigint | undefined);
  const [posId, setPosId] = useState("");
  // Never BigInt() raw input — it throws, and a throw here unmounts the card.
  const parsedPos = parseInteger(posId, "Position id");
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: mining } = useWaitForTransactionReceipt({ hash });
  const busy = isPending || mining || DEMO;

  return (
    <div className="card">
      <h2>Your credits</h2>
      <div className="stat"><span>Withdrawable (backing)</span><b>{fmt(credit, dec)}</b></div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={busy || !credit}
          onClick={() => writeContract({ ...pool, functionName: "withdrawCredit" })}>
          Withdraw credit
        </button>
      </div>
      <label htmlFor="claim-position">Claim earnings for position id</label>
      <div className="row">
        <input
          id="claim-position"
          value={posId}
          inputMode="numeric"
          onChange={(e) => setPosId(e.target.value)}
          placeholder="1"
          style={{ maxWidth: 120 }}
          aria-invalid={parsedPos.error ? true : undefined}
        />
        <button className="btn" disabled={busy || parsedPos.value === null}
          onClick={() => writeContract({ ...pool, functionName: "claimEarnings", args: [parsedPos.value!] })}>
          Claim earnings
        </button>
      </div>
      {parsedPos.error ? <p className="field-error" role="alert">{parsedPos.error}</p> : null}
      <p className="muted">All payouts are pull-based: earnings, refunds, sell-back proceeds, and crown tithes accrue as credit you withdraw here.</p>
    </div>
  );
}
