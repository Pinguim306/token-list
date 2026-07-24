"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { fmt, bpsToPct, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";

type Position = {
  depositor: `0x${string}`;
  asset: `0x${string}`;
  tokenId: bigint;
  backing: bigint;
  weight: bigint;
  active: boolean;
  feeDebt: bigint;
};

export function PositionsTable() {
  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals", query: { enabled: !DEMO } });
  const dec = DEMO ? demo.decimals : decimals ?? 18;
  const { data: count } = useReadContract({
    ...pool,
    functionName: "positionCount",
    query: { refetchInterval: 8000, enabled: !DEMO },
  });

  const n = count ? Number(count) : 0;
  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));

  const { data } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...pool, functionName: "positions", args: [id] } as const,
      { ...pool, functionName: "selectionOddsBps", args: [id] } as const,
    ]),
    query: { enabled: !DEMO && n > 0, refetchInterval: 8000 },
  });

  const rows = DEMO
    ? demo.positions.map((p) => ({ id: p.id, depositor: p.depositor, tokenId: p.tokenId, backing: p.backing, odds: p.oddsBps }))
    : (ids
        .map((id, i) => {
          const p = data?.[i * 2]?.result as unknown as Position | undefined;
          const odds = data?.[i * 2 + 1]?.result as bigint | undefined;
          return p && p.active ? { id, depositor: p.depositor, tokenId: p.tokenId, backing: p.backing, odds } : null;
        })
        .filter(Boolean) as { id: bigint; depositor: string; tokenId: bigint; backing: bigint; odds: bigint | undefined }[]);

  return (
    <div className="card">
      <h2>Positions ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="muted">No active positions yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>#</th><th>Depositor</th><th>Token</th><th>Backing</th><th>Win odds</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id.toString()}>
                <td>
                  <a href={`/app/position/${r.id.toString()}`} title={`Open position #${r.id}`}>
                    {r.id.toString()}
                  </a>
                </td>
                <td className="mono">{short(r.depositor)}</td>
                <td className="mono">#{r.tokenId.toString()}</td>
                <td>{fmt(r.backing, dec)}</td>
                <td><span className="odds">{r.odds !== undefined ? bpsToPct(r.odds) : "—"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ marginTop: 10 }}>
        Win odds are inversely proportional to backing (weight = 1e36 / backing) — lightly-backed
        positions are drawn most often.
      </p>
    </div>
  );
}
