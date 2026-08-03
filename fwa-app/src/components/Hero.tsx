"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { pool, backing, emitter } from "@/lib/contracts";
import { activeChain } from "@/lib/chains";
import { formatUnits } from "viem";
import { CountUp } from "./CountUp";
import { DEMO, demo } from "@/lib/demo";
import { ConnectButton } from "./ConnectButton";

export function Hero() {
  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals", query: { enabled: !DEMO } });
  const dec = DEMO ? demo.decimals : decimals ?? 18;

  const { data } = useReadContracts({
    contracts: [
      { ...pool, functionName: "acquisitionPrice" },
      { ...pool, functionName: "activeCount" },
      { ...pool, functionName: "topPot" },
      { ...emitter, functionName: "purchaserBudget" },
    ],
    query: { enabled: !DEMO, refetchInterval: 8000 },
  });
  const price = DEMO ? demo.price : (data?.[0]?.result as bigint | undefined);
  const active = DEMO ? demo.activeCount : (data?.[1]?.result as bigint | undefined);
  const pot = DEMO ? demo.topPot : (data?.[2]?.result as bigint | undefined);
  const budget = DEMO ? demo.purchaserBudget : (data?.[3]?.result as bigint | undefined);

  const num = (v: bigint | undefined, d: number) => (v === undefined ? 0 : Number(formatUnits(v, d)));
  const priceN = num(price, dec);
  const activeN = active === undefined ? 0 : Number(active);
  const potN = num(pot, dec);
  const budgetN = num(budget, 18);

  return (
    <>
      <nav className="nav">
        <a className="brand" href="/" aria-label="Fake World Assets — home">
          <div className="mark">F<span className="glow">W</span>A</div>
          <div>
            <div className="name">FAKE WORLD ASSETS</div>
            <div className="sub">{activeChain.name} · chainId {activeChain.id}</div>
          </div>
        </a>
        <div className="nav-actions">
          <a className="nav-link" href="/app/collection">Collections</a>
          <a className="nav-link" href="/app/draws">Draws</a>
          <a className="nav-link" href="/app/analytics">Analytics</a>
          <a className="nav-link" href="/app/baskets">Build packs</a>
          <a className="nav-link" href="/app/randomness">Fairness</a>
          <a className="nav-link" href="/app/portfolio">Portfolio</a>
          <a className="nav-link" href="/how-it-works">How it works</a>
          <ConnectButton />
        </div>
      </nav>

      <header className="hero">
        <span className="eyebrow"><span className="dot" /> BNB Chain · Tokenized stock packs</span>
        <h1>
          Rip packs of real stocks<br /> at <span className="accent">random</span>.
        </h1>
        <p className="lead">
          Every pack holds tokenized stocks — TSLA, NVDA and more — plus a backing stake. Pay the pool
          price to rip <b>one pack at random</b>, then keep the stocks or sell the pack back for its
          standing bid. Odds scale inversely with backing.
        </p>
        <div className="hero-cta">
          <a className="btn primary lg" href="#acquire">Rip a pack</a>
          <a className="btn lg" href="#deposit">Build a pack</a>
        </div>

        <div className="hero-stats">
          <div className="tile">
            <div className="k">Acquisition price</div>
            <div className="v"><CountUp value={priceN} decimals={2} /></div>
            <div className="u">per random draw</div>
          </div>
          <div className="tile">
            <div className="k">Packs in the pool</div>
            <div className="v"><CountUp value={activeN} /></div>
            <div className="u">in the pool</div>
          </div>
          <div className="tile">
            <div className="k">Crown tithe pot</div>
            <div className="v"><CountUp value={potN} decimals={1} /></div>
            <div className="u">to the top deposit</div>
          </div>
          <div className="tile">
            <div className="k">$FWA rewards</div>
            <div className="v"><CountUp value={budgetN} /></div>
            <div className="u">purchaser budget</div>
          </div>
        </div>
      </header>
    </>
  );
}
