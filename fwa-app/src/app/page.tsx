"use client";

import { ConnectButton } from "@/components/ConnectButton";
import { PoolStats } from "@/components/PoolStats";
import { PositionsTable } from "@/components/PositionsTable";
import { DepositForm } from "@/components/DepositForm";
import { DrawPanel } from "@/components/DrawPanel";
import { CreditsPanel } from "@/components/CreditsPanel";
import { RewardsPanel } from "@/components/RewardsPanel";
import { addresses } from "@/lib/contracts";
import { activeChain } from "@/lib/chains";

export default function Home() {
  const configured = addresses.pool !== "0x0000000000000000000000000000000000000000";
  return (
    <div className="container">
      <header className="top">
        <div>
          <h1>Fake World Assets</h1>
          <span className="muted">{activeChain.name} · chainId {activeChain.id}</span>
        </div>
        <ConnectButton />
      </header>
      {!configured && (
        <div className="notice">
          Set <span className="mono">NEXT_PUBLIC_POOL_ADDRESS</span> (see <span className="mono">.env.local.example</span>)
          to connect the UI to a deployed pool.
        </div>
      )}
      <div className="grid" style={{ marginTop: 16 }}>
        <PoolStats />
        <DrawPanel />
        <DepositForm />
        <PositionsTable />
        <CreditsPanel />
        <RewardsPanel />
      </div>
    </div>
  );
}
