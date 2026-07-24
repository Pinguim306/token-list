"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { pool, backing } from "@/lib/contracts";
import { fmt, bpsToPct, short } from "@/lib/format";

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
  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals" });
  const dec = decimals ?? 18;
  const { data: count } = useReadContract({
    ...pool,
    functionName: "positionCount",
    query: { refetchInterval: 8000 },
  });

  const n = count ? Number(count) : 0;
  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));

  const { data } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { ...pool, functionName: "positions", args: [id] } as const,
      { ...pool, functionName: "selectionOddsBps", args: [id] } as const,
    ]),
    query: { enabled: n > 0, refetchInterval: 8000 },
  });

  const rows = ids
    .map((id, i) => {
      const p = data?.[i * 2]?.result as unknown as Position | undefined;
      const odds = data?.[i * 2 + 1]?.result as bigint | undefined;
      return p && p.active ? { id, p, odds } : null;
    })
    .filter(Boolean) as { id: bigint; p: Position; odds: bigint | undefined }[];

  return (
    <div className="card">
      <h2>Positions ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="muted">No active positions yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Depositor</th>
              <th>Token</th>
              <th>Backing</th>
              <th>Win odds</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, p, odds }) => (
              <tr key={id.toString()}>
                <td>{id.toString()}</td>
                <td className="mono">{short(p.depositor)}</td>
                <td className="mono">#{p.tokenId.toString()}</td>
                <td>{fmt(p.backing, dec)}</td>
                <td>{odds !== undefined ? bpsToPct(odds) : "—"}</td>
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
