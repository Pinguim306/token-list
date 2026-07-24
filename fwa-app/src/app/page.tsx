"use client";

import { ConnectButton } from "@/components/ConnectButton";
import { PoolStats } from "@/components/PoolStats";
import { PositionsTable } from "@/components/PositionsTable";
import { DepositForm } from "@/components/DepositForm";
import { DrawPanel } from "@/components/DrawPanel";
import { CreditsPanel } from "@/components/CreditsPanel";
import { RewardsPanel } from "@/components/RewardsPanel";
import { activeChain } from "@/lib/chains";
import { DEMO } from "@/lib/demo";

export default function Home() {
  return (
    <div className="container">
      <header className="top">
        <div>
          <h1>Fake World Assets</h1>
          <span className="muted">{activeChain.name} · chainId {activeChain.id}</span>
        </div>
        <ConnectButton />
      </header>
      {DEMO && (
        <div className="notice">
          <b>Preview with sample data.</b> This dashboard is showing representative demo values.
          Point it at a deployed pool (set <span className="mono">NEXT_PUBLIC_POOL_ADDRESS</span>) for live,
          on-chain data and working transactions.
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
