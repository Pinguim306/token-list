/**
 * FWA keeper bot — the off-chain operator for KeeperHashChainAdapter.
 *
 *   ADAPTER=0x... KEEPER_MASTER_SECRET=0x<32 bytes> \
 *   npx hardhat run scripts/keeper-bot.js --network robinhood-testnet
 *
 * Env:
 *   ADAPTER               (required) deployed KeeperHashChainAdapter address
 *   KEEPER_MASTER_SECRET  (required) 32-byte hex; ALL chains derive from it
 *   CHAIN_LENGTH          reveals per committed chain (default 1000)
 *   MIN_REVEALS           re-commit a fresh chain below this (default 10)
 *   POLL_MS               loop interval (default 5000)
 *   FROM_BLOCK            adapter deploy block, to bound event scans (default 0)
 *   ONCE                  set to 1 to run a single tick and exit (smoke test)
 *
 * The signer (DEPLOYER_MNEMONIC in hardhat.config.js) must be the adapter's
 * keeper. The bot is stateless: on every tick it re-derives the active chain
 * from the master secret and the on-chain HeadCommitted count, locates the
 * current head, and does exactly one of wait / reveal / skip-stale / commit.
 * Kill it and restart it anytime — it loses nothing.
 *
 * SECURITY: the master secret IS the commitment. Anyone holding it can
 * predict every future preimage — combined with sequencer influence over the
 * seed blockhash, that reopens the grinding attack the commit-reveal exists
 * to prevent. Keep it in a secret manager, never in the repo; rotating it is
 * just committing a fresh head derived from a new secret (the epoch counter
 * restarts implicitly with FROM_BLOCK pointed at the rotation block).
 */
const hre = require("hardhat");
const { tick } = require("./keeper/core");

const POLL_MS = Number(process.env.POLL_MS ?? 5000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const addr = process.env.ADAPTER;
  const secret = process.env.KEEPER_MASTER_SECRET;
  if (!addr) throw new Error("Set ADAPTER=0x... (deployed KeeperHashChainAdapter)");
  if (!secret || !/^0x[0-9a-fA-F]{64}$/.test(secret)) {
    throw new Error("Set KEEPER_MASTER_SECRET=0x<64 hex chars> (32 bytes)");
  }

  const cfg = {
    masterSecret: secret,
    chainLength: Number(process.env.CHAIN_LENGTH ?? 1000),
    minReveals: Number(process.env.MIN_REVEALS ?? 10),
    fromBlock: Number(process.env.FROM_BLOCK ?? 0),
  };

  const [signer] = await hre.ethers.getSigners();
  const adapter = await hre.ethers.getContractAt("KeeperHashChainAdapter", addr, signer);

  const keeper = await adapter.keeper();
  if (keeper.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`signer ${signer.address} is not the adapter keeper ${keeper}`);
  }
  console.log(`keeper-bot: adapter=${addr} keeper=${signer.address} chainLength=${cfg.chainLength}`);

  let failures = 0;
  for (;;) {
    try {
      const res = await tick(adapter, cfg);
      failures = 0;
      if (res.action !== "idle" && res.action !== "wait") {
        console.log(new Date().toISOString(), res);
      }
    } catch (e) {
      failures += 1;
      console.error(new Date().toISOString(), `tick failed (${failures}):`, e.message ?? e);
      if (failures >= 5) console.error("keeper-bot: repeated failures — check RPC, funds, and secret");
      await sleep(Math.min(60_000, POLL_MS * 2 ** Math.min(failures, 4)));
    }
    if (process.env.ONCE === "1") break;
    await sleep(POLL_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
