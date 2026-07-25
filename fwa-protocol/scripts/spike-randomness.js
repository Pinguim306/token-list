/**
 * Fase 0 / G0 — randomness round-trip spike.
 *
 * Measures the one number the whole design rests on and that
 * `docs/fase0-findings.md` lists as UNMEASURED: how long a draw takes from
 * `startDraw` to the randomness callback, and what it costs per draw.
 *
 * Run:
 *   POOL=0x... SAMPLES=20 \
 *   npx hardhat run scripts/spike-randomness.js --network robinhood-testnet
 *
 * Env:
 *   POOL       (required) deployed FWAPool address
 *   SAMPLES    draws to fire (default 20)
 *   TIMEOUT_S  give up on a single draw after this many seconds (default 900)
 *   OUT        write the raw samples as JSON here (default spike-randomness.json)
 *
 * Prerequisites — this cannot run against an empty or unfunded deployment:
 *   - the pool holds at least one active position
 *   - the signer holds backing tokens and has approved the pool for
 *     SAMPLES * acquisitionPrice
 *   - the wired randomness adapter is live (CCIP↔VRF, or Pyth Entropy)
 *
 * The script never leaves a draw hanging: if one times out it calls
 * `expireDraw` so the pool unlocks and the run can continue.
 */
const fs = require("fs");
const hre = require("hardhat");

const SAMPLES = Number(process.env.SAMPLES ?? 20);
const TIMEOUT_S = Number(process.env.TIMEOUT_S ?? 900);
const OUT = process.env.OUT ?? "spike-randomness.json";
const POLL_MS = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarise(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    min: s[0],
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1],
    mean: Number((sum / s.length).toFixed(2)),
  };
}

async function main() {
  const poolAddr = process.env.POOL;
  if (!poolAddr) throw new Error("Set POOL=0x... (the deployed FWAPool address)");

  const [signer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const pool = await hre.ethers.getContractAt("FWAPool", poolAddr, signer);

  console.log(`network   : ${hre.network.name} (chainId ${net.chainId})`);
  console.log(`signer    : ${signer.address}`);
  console.log(`pool      : ${poolAddr}`);
  console.log(`samples   : ${SAMPLES}  timeout ${TIMEOUT_S}s\n`);

  const active = await pool.activeCount();
  if (active === 0n) {
    throw new Error("Pool has no active positions — deposit at least one before measuring.");
  }

  const backing = await hre.ethers.getContractAt("IERC20", await pool.backingToken(), signer);
  const price = await pool.acquisitionPrice();
  const allowance = await backing.allowance(signer.address, poolAddr);
  const needed = price * BigInt(SAMPLES);
  if (allowance < needed) {
    throw new Error(
      `Approve the pool for at least ${needed} backing (current allowance ${allowance}).`,
    );
  }

  const samples = [];

  for (let i = 0; i < SAMPLES; i++) {
    const drawId = (await pool.drawCount()) + 1n;
    const startedAt = Date.now();

    const tx = await pool.startDraw();
    const receipt = await tx.wait();
    const requestGas = receipt.gasUsed;
    const gasPrice = receipt.gasPrice ?? tx.gasPrice ?? 0n;

    let fulfilledAt = null;
    let expired = false;

    while (Date.now() - startedAt < TIMEOUT_S * 1000) {
      await sleep(POLL_MS);
      const d = await pool.draws(drawId);
      // 2 = Fulfilled, 3 = Settled — either means randomness landed.
      if (Number(d.state) >= 2) {
        fulfilledAt = Date.now();
        break;
      }
    }

    if (fulfilledAt === null) {
      // Never leave the pool frozen: refund and unlock so the run can continue.
      try {
        await (await pool.expireDraw(drawId)).wait();
        expired = true;
      } catch (e) {
        console.error(`  draw ${drawId}: timed out AND expireDraw failed — ${e.message}`);
      }
    } else {
      // Settle so the next draw is not blocked by the serialized-draw rule.
      try {
        await (await pool.settle(drawId, 0)).wait();
      } catch {
        try {
          await (await pool.finalize(drawId)).wait();
        } catch (e) {
          console.error(`  draw ${drawId}: could not settle or finalize — ${e.message}`);
        }
      }
    }

    const latency = fulfilledAt === null ? null : (fulfilledAt - startedAt) / 1000;
    samples.push({
      drawId: drawId.toString(),
      latencySeconds: latency,
      expired,
      requestGas: requestGas.toString(),
      gasPriceWei: gasPrice.toString(),
      requestCostWei: (requestGas * gasPrice).toString(),
      price: price.toString(),
    });

    console.log(
      `  draw ${drawId}: ${expired ? "TIMED OUT (refunded)" : `${latency}s`}  gas ${requestGas}`,
    );
  }

  const latencies = samples.filter((s) => s.latencySeconds !== null).map((s) => s.latencySeconds);
  const costs = samples.map((s) => Number(hre.ethers.formatEther(s.requestCostWei)));
  const timeouts = samples.filter((s) => s.expired).length;

  const report = {
    network: hre.network.name,
    chainId: Number(net.chainId),
    pool: poolAddr,
    samples: samples.length,
    timeouts,
    latencySeconds: summarise(latencies),
    requestCostEth: summarise(costs),
    raw: samples,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log("\n--- randomness round-trip ---");
  console.log(`fulfilled : ${latencies.length}/${samples.length}  (timeouts: ${timeouts})`);
  if (report.latencySeconds) {
    const l = report.latencySeconds;
    console.log(`latency s : p50 ${l.p50}  p95 ${l.p95}  max ${l.max}`);
  }
  if (report.requestCostEth) {
    const c = report.requestCostEth;
    console.log(`cost ETH  : p50 ${c.p50}  p95 ${c.p95}  (request tx only)`);
  }
  console.log(`\nwritten to ${OUT}`);
  console.log(
    "\nNote: cost above covers the request transaction only. Add the adapter's " +
      "CCIP fee and the VRF subscription draw-down for the true per-draw cost, " +
      "then record all of it in docs/fase0-findings.md item 1.",
  );

  if (timeouts > 0) {
    console.log(
      `\nWARNING: ${timeouts} draw(s) never received randomness within ${TIMEOUT_S}s. ` +
        "That is a liveness signal, not just slowness — investigate before closing G0.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
