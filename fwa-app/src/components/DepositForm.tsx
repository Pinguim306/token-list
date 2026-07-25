"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { pool, backing, nft, addresses } from "@/lib/contracts";
import { parseInteger, parseAmount } from "@/lib/parse";
import { DEMO } from "@/lib/demo";

export function DepositForm() {
  const { isConnected } = useAccount();
  const { data: decimals } = useReadContract({
    ...backing,
    functionName: "decimals",
    query: { enabled: !DEMO },
  });
  const dec = decimals ?? 18;

  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash });

  // A draw freezes the selection set, so the pool rejects deposits while one is
  // in flight. Reflect that here rather than letting the user pay gas to find out.
  const { data: drawInFlight } = useReadContract({
    ...pool,
    functionName: "drawInFlight",
    query: { enabled: !DEMO, refetchInterval: 8000 },
  });

  // Parsed defensively: BigInt() and parseUnits() throw, and this runs during
  // render — an unguarded call unmounts the whole page on a stray keystroke.
  const id = parseInteger(tokenId, "Token id");
  const amt = parseAmount(amount, dec, "Backing amount");

  const frozen = drawInFlight === true;
  const busy = isPending || mining;
  const blocked = busy || (!isConnected && !DEMO) || frozen;

  const canApproveNft = !blocked && id.value !== null;
  const canApproveBacking = !blocked && amt.value !== null;
  const canDeposit = !blocked && id.value !== null && amt.value !== null;

  const send = (fn: () => void) => {
    reset();
    fn();
  };

  return (
    <div className="card">
      <h2>Deposit a position</h2>

      <label htmlFor="dep-token">NFT token id</label>
      <input
        id="dep-token"
        inputMode="numeric"
        value={tokenId}
        onChange={(e) => setTokenId(e.target.value)}
        placeholder="1"
        aria-invalid={id.error ? true : undefined}
      />
      {id.error ? <p className="field-error" role="alert">{id.error}</p> : null}

      <label htmlFor="dep-amount">Backing amount</label>
      <input
        id="dep-amount"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="100"
        aria-invalid={amt.error ? true : undefined}
      />
      {amt.error ? <p className="field-error" role="alert">{amt.error}</p> : null}

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn"
          disabled={!canApproveNft}
          onClick={() =>
            send(() =>
              writeContract({ ...nft, functionName: "approve", args: [addresses.pool, id.value!] }),
            )
          }
        >
          Approve NFT
        </button>
        <button
          className="btn"
          disabled={!canApproveBacking}
          onClick={() =>
            send(() =>
              writeContract({
                ...backing,
                functionName: "approve",
                args: [addresses.pool, amt.value!],
              }),
            )
          }
        >
          Approve backing
        </button>
        <button
          className="btn primary"
          disabled={!canDeposit}
          onClick={() =>
            send(() =>
              writeContract({
                ...pool,
                functionName: "deposit",
                args: [addresses.nftCollection, id.value!, amt.value!],
              }),
            )
          }
        >
          {busy ? "Confirming…" : "Deposit"}
        </button>
      </div>

      {!isConnected && !DEMO ? (
        <p className="notice" role="status">Connect a wallet to deposit.</p>
      ) : null}
      {frozen ? (
        <p className="notice" role="status">
          A draw is in flight — the selection set is frozen, so deposits are paused until it settles.
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          Transaction failed: {(error as { shortMessage?: string }).shortMessage ?? error.message}
        </p>
      ) : null}
      {mined ? <p className="notice ok" role="status">Confirmed.</p> : null}

      <p className="muted">
        Approve the NFT and the backing token, then deposit. Your backing amount is also your
        standing bid.
      </p>
    </div>
  );
}
