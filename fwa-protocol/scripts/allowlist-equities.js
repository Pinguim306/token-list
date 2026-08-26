/**
 * Allowlist the full validated tokenized-stock catalog on the EquityBasket.
 *
 *   BASKET=0x... npx hardhat run scripts/allowlist-equities.js --network hyperevm
 *
 * Reads scripts/data/equities-hyperevm.json (53 assets — 35 Ondo + 18 Dinari,
 * every address validated on-chain; see docs/tokenized-stocks-hyperevm.md)
 * and calls basket.setTokenAllowed(token, true) for each one that is not
 * already allowed. Idempotent: safe to re-run after a partial failure.
 * The signer (DEPLOYER_MNEMONIC) must be the basket's owner.
 */
const hre = require("hardhat");
const catalog = require("./data/equities-hyperevm.json");

async function main() {
  const basketAddr = process.env.BASKET;
  if (!basketAddr) throw new Error("Set BASKET=0x... (deployed EquityBasket)");

  const [signer] = await hre.ethers.getSigners();
  const basket = await hre.ethers.getContractAt("EquityBasket", basketAddr, signer);
  console.log(`allowlisting ${catalog.length} equities on ${basketAddr} as ${signer.address}`);

  let done = 0, skipped = 0;
  for (const t of catalog) {
    if (await basket.allowedToken(t.address)) {
      skipped++;
      continue;
    }
    const tx = await basket.setTokenAllowed(t.address, true);
    await tx.wait();
    done++;
    console.log(`  allowed ${t.symbol.padEnd(8)} (${t.issuer}) ${t.address}`);
  }
  console.log(`done: ${done} allowed, ${skipped} already allowed`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
