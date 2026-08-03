"use client";

import { useState } from "react";
import {
  useAccount,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { basket, addresses } from "@/lib/contracts";
import { Erc20Abi, EquityBasketAbi } from "@/lib/abis";
import { parseAddress, parseAmount } from "@/lib/parse";
import { usdValue, fmtUsd } from "@/lib/prices";
import { DEMO, demo } from "@/lib/demo";

/** Mirrors EquityBasket.MAX_TOKENS. */
const MAX_TOKENS = 16;

type Row = { token: string; amount: string };

/**
 * Wrap allowlisted tokenized equities into a basket ERC-721. The contract
 * demands a strictly ascending token list — the form sorts rows by address at
 * submit time so users can enter them in any order, and duplicate detection
 * happens here instead of surfacing as a gas-wasting revert.
 */
export function BasketWrapForm() {
  const { isConnected } = useAccount();
  const [rows, setRows] = useState<Row[]>([{ token: "", amount: "" }]);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash });

  // Never-throw parsing: this runs during render, and a stray keystroke must
  // show a field error, not unmount the page (the DepositForm lesson).
  const parsed = rows.map((r) => ({
    addr: parseAddress(r.token, "Token address"),
    // Underlying decimals vary per token; amounts are entered in the token's
    // own units and scaled at 18 like the mock equities. Live symbol/decimals
    // for entered tokens are read below for display; scaling uses each row's
    // resolved decimals when available.
    raw: r,
  }));

  const validAddrs = parsed.map((p) => p.addr.value).filter(Boolean) as `0x${string}`[];

  // For each syntactically valid token: is it allowlisted, and what are its
  // symbol/decimals? One multicall, refreshed when addresses change.
  const { data: tokenMeta } = useReadContracts({
    contracts: validAddrs.flatMap((a) => [
      { address: addresses.basket, abi: EquityBasketAbi, functionName: "allowedToken", args: [a] } as const,
      { address: a, abi: Erc20Abi, functionName: "symbol" } as const,
      { address: a, abi: Erc20Abi, functionName: "decimals" } as const,
    ]),
    query: { enabled: !DEMO && validAddrs.length > 0 },
  });

  const metaFor = (addr: `0x${string}` | null) => {
    if (DEMO) {
      const eq = demo.equities.find((e) => e.address.toLowerCase() === addr?.toLowerCase());
      return { allowed: !!eq, symbol: eq?.symbol, decimals: 18 };
    }
    const i = addr ? validAddrs.indexOf(addr) : -1;
    if (i < 0) return { allowed: undefined, symbol: undefined, decimals: 18 };
    return {
      allowed: tokenMeta?.[i * 3]?.result as boolean | undefined,
      symbol: tokenMeta?.[i * 3 + 1]?.result as string | undefined,
      decimals: (tokenMeta?.[i * 3 + 2]?.result as number | undefined) ?? 18,
    };
  };

  const fields = parsed.map(({ addr, raw }) => {
    const meta = metaFor(addr.value);
    const amt = parseAmount(raw.amount, meta.decimals, "Amount");
    return { addr, amt, meta };
  });

  const lower = rows.map((r) => r.token.trim().toLowerCase()).filter((t) => t !== "");
  const hasDuplicate = new Set(lower).size !== lower.length;

  const complete =
    fields.length > 0 &&
    fields.every((f) => f.addr.value !== null && f.amt.value !== null) &&
    !hasDuplicate;
  const busy = isPending || mining;
  const blocked = busy || (!isConnected && !DEMO);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const send = (fn: () => void) => {
    reset();
    fn();
  };

  const wrap = () => {
    // The contract requires strictly ascending addresses; sort here so entry
    // order never matters to the user.
    const legs = fields
      .map((f) => ({ token: f.addr.value!, amount: f.amt.value! }))
      .sort((a, b) => (BigInt(a.token) < BigInt(b.token) ? -1 : 1));
    send(() =>
      writeContract({
        ...basket,
        functionName: "wrap",
        args: [legs.map((l) => l.token), legs.map((l) => l.amount)],
      }),
    );
  };

  return (
    <div className="card" data-basket-wrap>
      <h2>Add stocks to a pack</h2>

      {rows.map((row, i) => {
        const f = fields[i];
        return (
          <div key={i} className="wrap-row" data-wrap-row>
            <div className="wrap-row-fields">
              <div>
                <label htmlFor={`wrap-token-${i}`}>Stock token {i + 1}</label>
                <input
                  id={`wrap-token-${i}`}
                  className="mono"
                  value={row.token}
                  onChange={(e) => setRow(i, { token: e.target.value })}
                  placeholder={DEMO ? demo.equities[i % demo.equities.length].address : "0x…"}
                  aria-invalid={f.addr.error ? true : undefined}
                />
                {f.addr.error ? (
                  <p className="field-error" role="alert">{f.addr.error}</p>
                ) : null}
                {f.addr.value && f.meta.allowed === false ? (
                  <p className="field-error" role="alert">
                    This stock isn’t on the pack allowlist.
                  </p>
                ) : null}
                {f.addr.value && f.meta.symbol ? (
                  <p className="muted" data-token-symbol>{f.meta.symbol}</p>
                ) : null}
              </div>
              <div>
                <label htmlFor={`wrap-amount-${i}`}>Amount</label>
                <input
                  id={`wrap-amount-${i}`}
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => setRow(i, { amount: e.target.value })}
                  placeholder="10"
                  aria-invalid={f.amt.error ? true : undefined}
                />
                {f.amt.error ? (
                  <p className="field-error" role="alert">{f.amt.error}</p>
                ) : null}
              </div>
            </div>
            <div className="wrap-row-actions">
              <button
                className="btn"
                disabled={blocked || f.addr.value === null || f.amt.value === null}
                onClick={() =>
                  send(() =>
                    writeContract({
                      address: f.addr.value!,
                      abi: Erc20Abi,
                      functionName: "approve",
                      args: [addresses.basket, f.amt.value!],
                    }),
                  )
                }
              >
                Approve
              </button>
              {rows.length > 1 ? (
                <button
                  className="btn"
                  aria-label={`Remove token ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              ) : null}
            </div>
          </div>
        );
      })}

      {hasDuplicate ? (
        <p className="field-error" role="alert">
          The same stock appears twice — each stock can only be one slice of a pack.
        </p>
      ) : null}

      {(() => {
        // Contents valuation from the configured price map: shown only when
        // every complete leg is priced, so a partial sum never reads as the
        // basket's whole worth.
        const legs = fields.filter((f) => f.addr.value !== null && f.amt.value !== null);
        if (legs.length === 0) return null;
        const values = legs.map((f) => usdValue(f.addr.value!, f.amt.value!, f.meta.decimals));
        if (values.some((v) => v === null)) return null;
        const total = (values as number[]).reduce((a, v) => a + v, 0);
        return (
          <p className="notice" data-wrap-value role="status">
            Pack contents worth <b>≈ {fmtUsd(total)}</b> at configured prices — use this as your value
            estimate when you list the pack in the pool.
          </p>
        );
      })()}

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn"
          data-add-leg
          disabled={rows.length >= MAX_TOKENS}
          onClick={() => setRows((rs) => [...rs, { token: "", amount: "" }])}
        >
          Add stock ({rows.length}/{MAX_TOKENS})
        </button>
        <button className="btn primary" data-wrap-submit disabled={blocked || !complete} onClick={wrap}>
          {busy ? "Confirming…" : "Build the pack"}
        </button>
      </div>

      {!isConnected && !DEMO ? (
        <p className="notice" role="status">Connect a wallet to build a pack.</p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          Transaction failed: {(error as { shortMessage?: string }).shortMessage ?? error.message}
        </p>
      ) : null}
      {mined ? <p className="notice ok" role="status">Confirmed.</p> : null}

      <p className="muted">
        Approve each stock for the pack contract, then build. The pack mints as a single on-chain
        collectible you can list in the pool — whoever ends up holding it can unwrap it back into
        the underlying shares at any time.
      </p>
    </div>
  );
}
