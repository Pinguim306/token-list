"use client";

import { useState } from "react";
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { basket } from "@/lib/contracts";
import { Erc20Abi } from "@/lib/abis";
import { parseAddress } from "@/lib/parse";
import { fmt, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { HAS_INDEXER, useIndexerEscrows } from "@/lib/indexer";

/**
 * Recovery surface for basket-unwrap payouts that could not be delivered
 * (e.g. the equity token was paused at unwrap time). The contract escrows the
 * leg in `stuckToken[token][account]`; `claimStuckToken` releases it once the
 * token can transfer again.
 *
 * Discovery is three-tier: demo sample data; the indexer's basketEscrow table
 * (account-keyed); and — because the app must work against a bare chain — a
 * manual "check a token" probe that reads `stuckToken(token, you)` directly.
 */
export function StuckPayouts() {
  const { address, isConnected } = useAccount();
  const [probe, setProbe] = useState("");
  const probeAddr = parseAddress(probe, "Token address");

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash });
  const busy = isPending || mining || DEMO;

  const indexed = useIndexerEscrows(address, !DEMO && isConnected);

  // Manual probe (RPC fallback): amount escrowed for the entered token + its meta.
  const { data: probed } = useReadContracts({
    contracts: probeAddr.value && address
      ? [
          { ...basket, functionName: "stuckToken", args: [probeAddr.value, address] } as const,
          { address: probeAddr.value, abi: Erc20Abi, functionName: "symbol" } as const,
          { address: probeAddr.value, abi: Erc20Abi, functionName: "decimals" } as const,
        ]
      : [],
    query: { enabled: !DEMO && !!probeAddr.value && !!address },
  });
  const probedAmount = probed?.[0]?.result as bigint | undefined;
  const probedSymbol = probed?.[1]?.result as string | undefined;
  const probedDec = (probed?.[2]?.result as number | undefined) ?? 18;

  type Row = { token: `0x${string}`; symbol: string; amount: bigint; decimals: number };
  const rows: Row[] = DEMO
    ? demo.stuckPayouts.map((s) => ({ token: s.token as `0x${string}`, symbol: s.symbol, amount: s.amount, decimals: s.decimals }))
    : (indexed.data ?? []).map((e) => ({ token: e.token, symbol: short(e.token), amount: e.amount, decimals: 18 }));

  const claim = (token: `0x${string}`) => {
    reset();
    writeContract({ ...basket, functionName: "claimStuckToken", args: [token] });
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm" data-stuck-payouts>
      <div className="border-b border-border px-6 py-4">
        <h2 className="m-0 font-display text-base text-ink">Escrowed payouts</h2>
        <p className="m-0 mt-0.5 font-body text-xs text-muted">
          Unwrap legs that could not be delivered (e.g. a paused equity) wait here — claim them once
          the token transfers again.
        </p>
      </div>
      <div className="px-6 py-5">
        {rows.length === 0 ? (
          <p className="m-0 font-body text-sm text-muted">
            {!DEMO && !isConnected
              ? "Connect a wallet to check your escrowed payouts."
              : !DEMO && !HAS_INDEXER
                ? "Nothing found via the probe below — enter a token address to check."
                : "Nothing escrowed for you. Failed unwrap legs would appear here."}
          </p>
        ) : (
          <ul className="m-0 list-none space-y-3 p-0">
            {rows.map((r) => (
              <li
                key={r.token}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-4 py-3"
                data-stuck-payout={r.token}
              >
                <div>
                  <p className="m-0 font-body text-sm text-ink">
                    {fmt(r.amount, r.decimals)} <b>{r.symbol}</b>
                  </p>
                  <p className="m-0 mt-0.5 font-mono text-xs text-muted">{short(r.token)}</p>
                </div>
                <button
                  className="btn primary"
                  disabled={busy}
                  
                  onClick={() => claim(r.token)}
                >
                  {busy && !DEMO ? "Confirming…" : "Claim"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {!DEMO ? (
          <div className="mt-4 border-t border-border pt-4">
            <label htmlFor="probe-token" className="font-body text-xs font-semibold text-muted">
              Check a token address directly
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                id="probe-token"
                className="mono"
                value={probe}
                onChange={(e) => setProbe(e.target.value)}
                placeholder="0x…"
                style={{ maxWidth: 340 }}
                aria-invalid={probeAddr.error ? true : undefined}
              />
              {probeAddr.value && probedAmount !== undefined ? (
                probedAmount > 0n ? (
                  <button className="btn primary" disabled={busy} onClick={() => claim(probeAddr.value!)}>
                    Claim {fmt(probedAmount, probedDec)} {probedSymbol ?? ""}
                  </button>
                ) : (
                  <span className="self-center font-body text-xs text-muted">Nothing escrowed for this token.</span>
                )
              ) : null}
            </div>
            {probeAddr.error ? <p className="field-error" role="alert">{probeAddr.error}</p> : null}
          </div>
        ) : null}

        {error ? (
          <p className="field-error" role="alert">
            Claim failed: {(error as { shortMessage?: string }).shortMessage ?? error.message} — if the
            token is still paused, the balance is preserved; try again later.
          </p>
        ) : null}
        {mined ? <p className="notice ok" role="status">Claimed.</p> : null}
      </div>
    </section>
  );
}
