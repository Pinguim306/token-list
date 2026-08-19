"use client";

import { Hero } from "@/components/Hero";
import { BackgroundFx } from "@/components/BackgroundFx";
import { Ticker } from "@/components/Ticker";
import { PoolStats } from "@/components/PoolStats";
import { PositionsTable } from "@/components/PositionsTable";
import { DepositForm } from "@/components/DepositForm";
import { DrawPanel } from "@/components/DrawPanel";
import { CreditsPanel } from "@/components/CreditsPanel";
import { RewardsPanel } from "@/components/RewardsPanel";
import { DEMO } from "@/lib/demo";

export default function Home() {
  return (
    <div className="fwa-container">
      <BackgroundFx />
      <Hero />
      <Ticker />

      {DEMO && (
        <div className="notice" style={{ marginTop: 8 }}>
          <b>Live demo checkout.</b> Sample packs, real payment: connect a wallet and buying a pack
          sends the pack price in BNB to the FWA treasury — the draw and settlement are simulated
          exactly as the contracts will run them. Point the app at a deployed pool
          (<span className="mono">NEXT_PUBLIC_POOL_ADDRESS</span>) to switch to full on-chain mode.
        </div>
      )}

      <div className="section-title" id="acquire">The pool</div>
      <div className="fwa-grid">
        <DrawPanel />
        <PoolStats />
        <PositionsTable />
      </div>

      <div className="section-title" id="deposit">Participate</div>
      <div className="fwa-grid">
        <DepositForm />
        <CreditsPanel />
        <RewardsPanel />
      </div>

      <footer className="foot">
        <span>Fake World Assets · a randomized onchain acquisition protocol</span>
        <span className="tm">FWA™ · BNB Chain</span>
      </footer>
    </div>
  );
}
