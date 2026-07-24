/**
 * Fase 0 probe — inventories what a target chain (default: RobinhoodChain
 * testnet, chainId 46630) actually provides, so the go/no-go gate is based on
 * evidence rather than assumption.
 *
 * Run:  npx hardhat run scripts/probe-chain.js --network robinhood-testnet
 *
 * Checks:
 *   - chainId / block number / gas price
 *   - Arbitrum Nitro precompiles (ArbSys, ArbGasInfo) and ArbOS version
 *   - arbBlockNumber() vs block.number divergence (must use ArbSys for L2 blocks)
 *   - bytecode presence/size at candidate infra addresses (randomness, DEX, oracles)
 *
 * IMPORTANT: the candidate addresses below are placeholders. Fill them from the
 * official RobinhoodChain protocol-contracts docs and each provider's chainlist
 * before trusting the "PRESENT/ABSENT" verdict.
 */
const hre = require("hardhat");

const ARB_SYS = "0x0000000000000000000000000000000000000064";
const ARB_GAS_INFO = "0x000000000000000000000000000000000000006C";

// TODO(Fase 0): replace with real addresses from official docs / provider chainlists.
const CANDIDATES = {
  "Multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11",
  "Chainlink CCIP Router (fill from docs)": "0x0000000000000000000000000000000000000000",
  "Pyth Entropy (fill from chainlist)": "0x0000000000000000000000000000000000000000",
  "Uniswap v4 PoolManager (fill from Blockscout)": "0x0000000000000000000000000000000000000000",
};

async function codeSize(provider, addr) {
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return null;
  const code = await provider.getCode(addr);
  return (code.length - 2) / 2; // bytes
}

async function main() {
  const provider = hre.ethers.provider;
  const net = await provider.getNetwork();
  const block = await provider.getBlockNumber();
  const fee = await provider.getFeeData();

  console.log("=== Chain ===");
  console.log("chainId       :", net.chainId.toString());
  console.log("block.number  :", block);
  console.log("gasPrice(wei) :", (fee.gasPrice ?? 0n).toString());

  console.log("\n=== Arbitrum Nitro precompiles ===");
  const arbSys = new hre.ethers.Contract(
    ARB_SYS,
    ["function arbBlockNumber() view returns (uint256)", "function arbOSVersion() view returns (uint256)"],
    provider
  );
  try {
    const arbBlock = await arbSys.arbBlockNumber();
    console.log("ArbSys.arbBlockNumber():", arbBlock.toString(), "(use THIS for L2 block windows, not block.number)");
  } catch (e) {
    console.log("ArbSys.arbBlockNumber(): ABSENT ->", e.shortMessage || e.message);
  }
  try {
    const osv = await arbSys.arbOSVersion();
    console.log("ArbSys.arbOSVersion()  :", osv.toString(), "(gates Shanghai/Cancun opcode support)");
  } catch (e) {
    console.log("ArbSys.arbOSVersion()  : unavailable ->", e.shortMessage || e.message);
  }
  console.log("ArbGasInfo code bytes  :", await codeSize(provider, ARB_GAS_INFO));

  console.log("\n=== Infra bytecode presence ===");
  for (const [label, addr] of Object.entries(CANDIDATES)) {
    const size = await codeSize(provider, addr);
    const verdict = size === null ? "SKIPPED (no address)" : size > 0 ? `PRESENT (${size} bytes)` : "ABSENT";
    console.log(`${label.padEnd(48)} ${addr}  ${verdict}`);
  }

  console.log("\nReminder: Chainlink VRF is NOT expected on RobinhoodChain. The");
  console.log("supported randomness path is VRF-via-CCIP from Arbitrum One (see");
  console.log("CCIPVRFAdapter) or a natively-onboarded provider (Pyth Entropy).");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
