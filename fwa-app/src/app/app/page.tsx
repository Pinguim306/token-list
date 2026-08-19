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

export default function Home() {
  return (
    <div className="fwa-container">
      <BackgroundFx />
      <Hero />
      <Ticker />

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
