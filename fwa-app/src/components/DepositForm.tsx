"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { pool, backing, nft, addresses } from "@/lib/contracts";
import { parseInteger, parseAmount } from "@/lib/parse";
import { DEMO, demo } from "@/lib/demo";
import { fmt, bpsToPct, BPS } from "@/lib/format";
import { BackingHealth } from "@/components/BackingHealth";

/** weight = 1e36 / backing (the pool's inverse-selection rule). */
const NUM = 10n ** 36n;

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
  const [estimate, setEstimate] = useState("");

  // Everything the live preview needs, in one batch.
  const { data: poolStats } = useReadContracts({
    contracts: [
      { ...pool, functionName: "bidBps" } as const,
      { ...pool, functionName: "totalWeight" } as const,
      { ...pool, functionName: "activeCount" } as const,
      { ...pool, functionName: "acquisitionPrice" } as const,
      { ...pool, functionName: "acquisitionCutBps" } as const,
      { ...pool, functionName: "topListingId" } as const,
      { ...pool, functionName: "topShareBps" } as const,
    ],
    query: { enabled: !DEMO, refetchInterval: 10000 },
  });
  const stat = (i: number) => poolStats?.[i]?.result as bigint | undefined;
  const bidBps = DEMO ? demo.bidBps : (stat(0) ?? 8500n);
  const totalWeight = DEMO
    ? demo.positions.reduce((a, p) => a + NUM / p.backing, 0n)
    : (stat(1) ?? 0n);
  const activeCount = DEMO ? demo.activeCount : (stat(2) ?? 0n);
  const price = DEMO ? demo.price : (stat(3) ?? 0n);
  const cutBps = DEMO ? demo.acquisitionCutBps : (stat(4) ?? 0n);
  const crowned = DEMO ? demo.topListingId !== 0n : (stat(5) ?? 0n) !== 0n;
  const topShareBps = DEMO ? demo.topShareBps : (stat(6) ?? 0n);

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
  const val = parseAmount(estimate, dec, "Estimated value");

  // Live preview of what this exact backing buys.
  const weight = amt.value ? NUM / amt.value : null;
  const bid = amt.value ? (amt.value * bidBps) / BPS : null;
  const oddsBps = weight ? (weight * BPS) / (totalWeight + weight) : null;
  const oneIn = weight ? Math.max(1, Math.round(Number(totalWeight + weight) / Number(weight))) : null;
  // Your equal share of each draw's distributable fee once you join (+1 position).
  const feePerDraw =
    price > 0n
      ? (((price * (BPS - cutBps)) / BPS) * (crowned ? BPS - topShareBps : BPS)) / BPS / (activeCount + 1n)
      : null;

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
      <h2>List a pack</h2>

      <label htmlFor="dep-token">Pack (token) id</label>
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

      {amt.value !== null && bid !== null ? (
        <div className="dep-preview" data-deposit-preview>
          <div className="stat">
            <span>Standing bid ({bpsToPct(bidBps)})</span>
            <b>{fmt(bid, dec)}</b>
          </div>
          <div className="stat">
            <span>Draw odds</span>
            <b>
              {oddsBps !== null ? bpsToPct(oddsBps) : "—"}
              {oneIn !== null ? ` · 1 in ${oneIn}` : ""}
            </b>
          </div>
          <div className="stat">
            <span>Est. earnings per draw</span>
            <b>{feePerDraw !== null ? `≈ ${fmt(feePerDraw, dec)}` : "—"}</b>
          </div>
        </div>
      ) : null}

      <label htmlFor="dep-value">
        Estimated item value <span className="lbl-hint">(optional — checks your backing)</span>
      </label>
      <input
        id="dep-value"
        inputMode="decimal"
        value={estimate}
        onChange={(e) => setEstimate(e.target.value)}
        placeholder="What would this sell for today?"
        aria-invalid={val.error ? true : undefined}
      />
      {val.error ? <p className="field-error" role="alert">{val.error}</p> : null}
      {amt.value !== null && val.value !== null ? (
        <BackingHealth backing={amt.value} value={val.value} bidBps={bidBps} decimals={dec} />
      ) : null}

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
          Approve pack
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
        Approve the pack and the backing token, then deposit. Your backing amount is also your
        standing bid — the deposit form checks it against your value estimate above.
      </p>
    </div>
  );
}
