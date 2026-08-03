/**
 * FWA replenisher bot — keeps the pack pool stocked from the PackVault.
 *
 *   VAULT=0x... npx hardhat run scripts/replenisher-bot.js --network bscTestnet
 *
 * Env:
 *   VAULT      (required) deployed PackVault address
 *   POLL_MS    loop interval (default 30000)
 *   ONCE       set to 1 to run a single tick and exit (smoke test)
 *
 * The crank itself is PERMISSIONLESS and fully guarded on-chain (floor,
 * cooldown, draw-in-flight, inventory) — this bot merely pays the gas to call
 * it at the right time. Every guard failure is an expected idle condition,
 * not an error, except "PV: inventory empty": that means the pool is below
 * floor and the vault has nothing left to mint from — page the operator to
 * refill the inventory (recycle fees into stocks + backing).
 */
const hre = require("hardhat");

const POLL_MS = Number(process.env.POLL_MS ?? 30_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDLE = ["PV: pool above floor", "PV: cooldown", "PV: draw in flight", "PV: crank disabled"];

async function main() {
  const addr = process.env.VAULT;
  if (!addr) throw new Error("Set VAULT=0x... (deployed PackVault)");
  const [signer] = await hre.ethers.getSigners();
  const vault = await hre.ethers.getContractAt("PackVault", addr, signer);
  console.log(`replenisher-bot: vault=${addr} signer=${signer.address}`);

  for (;;) {
    try {
      // simulate first so idle conditions cost no gas
      await vault.replenishIfNeeded.staticCall();
      const tx = await vault.replenishIfNeeded();
      const rc = await tx.wait();
      console.log(new Date().toISOString(), `replenished (tx ${rc.hash})`);
    } catch (e) {
      const reason = e?.revert?.args?.[0] ?? e?.reason ?? e?.message ?? String(e);
      if (String(reason).includes("PV: inventory empty")) {
        console.error(new Date().toISOString(), "INVENTORY EMPTY — pool below floor and nothing to mint. Refill the vault!");
      } else if (!IDLE.some((m) => String(reason).includes(m))) {
        console.error(new Date().toISOString(), "tick failed:", reason);
      }
    }
    if (process.env.ONCE === "1") break;
    await sleep(POLL_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
