/**
 * Register the deliverable dStock catalog on a deployed PackRip.
 *
 *   PACKRIP=0x... npx hardhat run scripts/setup-packrip-stocks.js --network hyperevm
 *
 * Reads scripts/data/dstocks-hyperevm.json (HyperCore-linked Dinari dStocks,
 * verified on-chain; see docs/tokenized-stocks-hyperevm.md) and calls
 * packRip.setStock(token, spotPairIndex, pxScale, true) for each ACTIVE entry
 * whose config isn't already on-chain. Idempotent: safe to re-run after a
 * partial failure. The signer (DEPLOYER_MNEMONIC) must be PackRip's owner.
 */
const hre = require("hardhat");
const catalog = require("./data/dstocks-hyperevm.json");

async function main() {
  const ripAddr = process.env.PACKRIP;
  if (!ripAddr) throw new Error("Set PACKRIP=0x... (deployed PackRip)");

  const [signer] = await hre.ethers.getSigners();
  const rip = await hre.ethers.getContractAt("PackRip", ripAddr, signer);
  const active = catalog.filter((d) => d.active);
  console.log(`registering ${active.length} dStocks on ${ripAddr} as ${signer.address}`);

  let done = 0, skipped = 0;
  for (const d of active) {
    const cur = await rip.stocks(d.address);
    if (cur.allowed && Number(cur.spotIndex) === d.spotPairIndex && Number(cur.pxScale) === d.pxScale) {
      skipped++;
      continue;
    }
    const tx = await rip.setStock(d.address, d.spotPairIndex, d.pxScale, true);
    await tx.wait();
    done++;
    console.log(`  set ${d.ticker.padEnd(6)} (${d.symbol}) @${d.spotPairIndex} scale=${d.pxScale} ${d.address}`);
  }
  console.log(`done: ${done} set, ${skipped} already configured`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
