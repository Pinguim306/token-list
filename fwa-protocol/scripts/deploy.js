/**
 * Deploys the FWA stack to the configured network.
 *
 *   npx hardhat run scripts/deploy.js --network robinhood-testnet
 *
 * Wiring: RandomnessRouter -> adapter, FWAWhitelist, FeeRouter,
 * FWAFactory -> FWAPool, EquityBasket (whitelisted), $FWA token + emitter.
 *
 * Adapter selection via ADAPTER=
 *   keeper (default) — KeeperHashChainAdapter, the oracle-free launch path.
 *                      KEEPER=0x... overrides the keeper address (defaults to
 *                      the deployer). After deploy, run scripts/keeper-bot.js
 *                      to commit the first chain and serve draws.
 *   vrf              — VRFDirectAdapter: Chainlink VRF v2.5, native on BNB
 *                      Chain (no CCIP hop). Requires configure() post-deploy
 *                      with the coordinator/keyHash/subId for the network.
 *   mock             — MockRandomnessAdapter, manually drivable (local/demo).
 *   ccip             — CCIPVRFAdapter skeleton (legacy RobinhoodChain path).
 *                      USE_CCIP=1 also works for backward compatibility.
 *
 * Also deploys the PackVault (bundle seeding + pool replenishment). Fund it
 * with stock tokens + backing, setTemplate + setPolicy, then mintBundle for
 * launch and run scripts/replenisher-bot.js for automation.
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const E = hre.ethers;
  console.log("Deployer:", deployer.address);

  // A backing token must exist on-chain (e.g. USDG). For testnet we deploy a mock.
  const backing = await (await E.getContractFactory("MockERC20")).deploy("Mock USDG", "USDG", 18);
  await backing.waitForDeployment();

  const whitelist = await (await E.getContractFactory("FWAWhitelist")).deploy(deployer.address);
  await whitelist.waitForDeployment();

  const router = await (await E.getContractFactory("RandomnessRouter")).deploy(deployer.address);
  await router.waitForDeployment();

  const kind = process.env.USE_CCIP === "1" ? "ccip" : (process.env.ADAPTER ?? "keeper");
  let adapter;
  if (kind === "ccip") {
    adapter = await (await E.getContractFactory("CCIPVRFAdapter")).deploy(deployer.address, await router.getAddress());
  } else if (kind === "mock") {
    adapter = await (await E.getContractFactory("MockRandomnessAdapter")).deploy(await router.getAddress());
  } else if (kind === "keeper") {
    const keeper = process.env.KEEPER ?? deployer.address;
    adapter = await (await E.getContractFactory("KeeperHashChainAdapter")).deploy(
      await router.getAddress(), keeper, deployer.address
    );
  } else if (kind === "vrf") {
    adapter = await (await E.getContractFactory("VRFDirectAdapter")).deploy(
      await router.getAddress(), deployer.address
    );
  } else {
    throw new Error(`Unknown ADAPTER="${kind}" (expected keeper | mock | ccip)`);
  }
  await adapter.waitForDeployment();
  await (await router.setAdapter(await adapter.getAddress())).wait();

  const feeRouter = await (await E.getContractFactory("FeeRouter")).deploy(
    deployer.address, [deployer.address], [10000n]
  );
  await feeRouter.waitForDeployment();

  const factory = await (await E.getContractFactory("FWAFactory")).deploy(deployer.address);
  await factory.waitForDeployment();

  const tx = await factory.createPool(
    await backing.getAddress(),
    await router.getAddress(),
    await whitelist.getAddress(),
    await feeRouter.getAddress(),
    deployer.address
  );
  await tx.wait();
  const pool = (await factory.allPools(0));
  await (await router.setConsumer(pool, true)).wait();

  // Equity baskets: tokenized stocks wrap into an ERC-721 the pool already
  // understands. The basket collection itself is whitelisted here; which
  // equity tokens may be wrapped is curated later via basket.setTokenAllowed.
  const basket = await (await E.getContractFactory("EquityBasket")).deploy(deployer.address);
  await basket.waitForDeployment();
  await (await whitelist.setAllowed(await basket.getAddress(), true)).wait();

  // Pack vault: bundle seeding + permissionless replenishment. The operator
  // funds it with stocks + backing, sets the template/policy, and mints.
  const vault = await (await E.getContractFactory("PackVault")).deploy(
    await basket.getAddress(), pool, await backing.getAddress(), deployer.address
  );
  await vault.waitForDeployment();

  // $FWA token + emissions (Fase 2).
  const CAP = 1_000_000_000n * 10n ** 18n;
  const fwa = await (await E.getContractFactory("FWAToken")).deploy(CAP, deployer.address, deployer.address);
  await fwa.waitForDeployment();
  const emitter = await (await E.getContractFactory("FWAEmitter")).deploy(await fwa.getAddress(), deployer.address);
  await emitter.waitForDeployment();
  await (await emitter.setPool(pool)).wait();
  const poolC = await E.getContractAt("FWAPool", pool);
  await (await poolC.setEmitter(await emitter.getAddress())).wait();
  await (await fwa.setFeeExempt(await emitter.getAddress(), true)).wait();

  console.log(JSON.stringify({
    adapterKind: kind,
    backing: await backing.getAddress(),
    whitelist: await whitelist.getAddress(),
    router: await router.getAddress(),
    adapter: await adapter.getAddress(),
    feeRouter: await feeRouter.getAddress(),
    factory: await factory.getAddress(),
    pool,
    basket: await basket.getAddress(),
    vault: await vault.getAddress(),
    fwa: await fwa.getAddress(),
    emitter: await emitter.getAddress(),
  }, null, 2));

  if (kind === "keeper") {
    console.log(
      "\nNext: start the keeper bot so draws can resolve:\n" +
        `  ADAPTER=${await adapter.getAddress()} KEEPER_MASTER_SECRET=0x<32 bytes> \\\n` +
        "  npx hardhat run scripts/keeper-bot.js --network <network>"
    );
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
