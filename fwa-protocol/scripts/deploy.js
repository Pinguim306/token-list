/**
 * Deploys the FWA stack to the configured network.
 *
 *   npx hardhat run scripts/deploy.js --network robinhood-testnet
 *
 * Wiring: RandomnessRouter -> (Mock|CCIPVRF) adapter, FWAWhitelist, FeeRouter,
 * FWAFactory -> FWAPool. On testnet a MockRandomnessAdapter is used by default so
 * the flow is drivable end-to-end; set USE_CCIP=1 to deploy the CCIPVRFAdapter
 * skeleton instead (still requires configure() with real CCIP/VRF params).
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

  let adapter;
  if (process.env.USE_CCIP === "1") {
    adapter = await (await E.getContractFactory("CCIPVRFAdapter")).deploy(deployer.address, await router.getAddress());
  } else {
    adapter = await (await E.getContractFactory("MockRandomnessAdapter")).deploy(await router.getAddress());
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
    backing: await backing.getAddress(),
    whitelist: await whitelist.getAddress(),
    router: await router.getAddress(),
    adapter: await adapter.getAddress(),
    feeRouter: await feeRouter.getAddress(),
    factory: await factory.getAddress(),
    pool,
    fwa: await fwa.getAddress(),
    emitter: await emitter.getAddress(),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
