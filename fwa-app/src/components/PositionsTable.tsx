"use client";

import { fmt, bpsToPct, short } from "@/lib/format";
import { usePositions } from "@/lib/usePositions";

export function PositionsTable() {
  const { positions, decimals } = usePositions();

  return (
    <div className="card">
      <h2>Positions ({positions.length})</h2>
      {positions.length === 0 ? (
        <p className="muted">No active positions yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>#</th><th>Depositor</th><th>Token</th><th>Backing</th><th>Win odds</th></tr>
          </thead>
          <tbody>
            {positions.map((r) => (
              <tr key={r.id.toString()}>
                <td>
                  <a href={`/app/position/${r.id.toString()}`} title={`Open position #${r.id}`}>
                    {r.id.toString()}
                  </a>
                </td>
                <td className="mono">{short(r.depositor)}</td>
                <td className="mono">#{r.tokenId.toString()}</td>
                <td>{fmt(r.backing, decimals)}</td>
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
