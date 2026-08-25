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
 *   entropy          — PythEntropyAdapter: Pyth Entropy two-party commit-reveal,
 *                      the verifiable path on HyperEVM. Requires
 *                      ENTROPY_ADDRESS and ENTROPY_PROVIDER (the chain's
 *                      published Entropy deployment — docs.pyth.network,
 *                      verified on the explorer first). Prefund the adapter
 *                      with native HYPE after deploy: it pays Entropy's
 *                      per-request fee from its own balance.
 *   vrf              — VRFDirectAdapter: Chainlink VRF v2.5. NOT available on
 *                      HyperEVM (Chainlink ships data feeds there, not VRF), so
 *                      this path is refused on chains 999/998 — it is kept for
 *                      BNB Chain. Requires configure() post-deploy with the
 *                      coordinator/keyHash/subId for the network.
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
  } else if (kind === "entropy") {
    // Pyth Entropy — the verifiable path on HyperEVM. The Entropy contract and
    // provider come from the chain's published deployment (docs.pyth.network)
    // and must be verified on the explorer before being wired here.
    const entropyAddr = process.env.ENTROPY_ADDRESS;
    const providerAddr = process.env.ENTROPY_PROVIDER;
    if (!entropyAddr || !providerAddr) {
      throw new Error(
        "ADAPTER=entropy requires ENTROPY_ADDRESS and ENTROPY_PROVIDER " +
          "(the chain's Entropy deployment — see docs.pyth.network, verify on the explorer first).",
      );
    }
    adapter = await (await E.getContractFactory("PythEntropyAdapter")).deploy(
      await router.getAddress(), deployer.address
    );
    await adapter.waitForDeployment();
    await (await adapter.configure(entropyAddr, providerAddr)).wait();
  } else if (kind === "vrf") {
    // Chainlink VRF has no coordinator on HyperEVM. Deploying this adapter
    // there would wire the router to a backend that can never answer, and
    // every draw would sit until it expired — fail loudly instead.
    const { chainId } = await E.provider.getNetwork();
    if (chainId === 999n || chainId === 998n) {
      throw new Error(
        `ADAPTER=vrf is not deployable on HyperEVM (chainId ${chainId}): Chainlink VRF ` +
          `has no coordinator on this chain. Use ADAPTER=keeper for launch or ` +
          `ADAPTER=entropy for the verifiable path.`,
      );
    }
    adapter = await (await E.getContractFactory("VRFDirectAdapter")).deploy(
      await router.getAddress(), deployer.address
    );
  } else {
    throw new Error(`Unknown ADAPTER="${kind}" (expected keeper | entropy | vrf | mock | ccip)`);
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
  } else if (kind === "entropy") {
    console.log(
      "\nNext: prefund the adapter so it can pay Entropy's per-request fee\n" +
        `(plain native transfer to ${await adapter.getAddress()}), and top it up as part of ops.`
    );
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
