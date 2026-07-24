"use client";

import { useState } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { pool, backing, nft, addresses } from "@/lib/contracts";

export function DepositForm() {
  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals" });
  const dec = decimals ?? 18;
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: mining } = useWaitForTransactionReceipt({ hash });
  const busy = isPending || mining;

  const id = tokenId ? BigInt(tokenId) : 0n;
  const amt = amount ? parseUnits(amount, dec) : 0n;

  return (
    <div className="card">
      <h2>Deposit a position</h2>
      <label>NFT token id</label>
      <input value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="1" />
      <label>Backing amount</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy || !id}
          onClick={() => writeContract({ ...nft, functionName: "approve", args: [addresses.pool, id] })}>
          Approve NFT
        </button>
        <button className="btn" disabled={busy || !amt}
          onClick={() => writeContract({ ...backing, functionName: "approve", args: [addresses.pool, amt] })}>
          Approve backing
        </button>
        <button className="btn primary" disabled={busy || !id || !amt}
          onClick={() => writeContract({ ...pool, functionName: "deposit", args: [addresses.nftCollection, id, amt] })}>
          Deposit
        </button>
      </div>
      <p className="muted">Approve the NFT and the backing token, then deposit. Blocked while a draw is in flight.</p>
    </div>
  );
}
