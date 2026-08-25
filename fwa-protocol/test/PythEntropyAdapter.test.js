const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * PythEntropyAdapter: Pyth Entropy two-party commit-reveal — the verifiable
 * randomness path on HyperEVM. Round-trip against a mock Entropy contract;
 * the router path is identical to the other adapters. The adapter pays the
 * per-request native fee from its own prefunded balance.
 */
describe("PythEntropyAdapter", function () {
  const FEE = ethers.parseEther("0.001");
  const PROVIDER = "0x00000000000000000000000000000000000000A1";

  async function deploy() {
    const [owner, other] = await ethers.getSigners();
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (await ethers.getContractFactory("PythEntropyAdapter")).deploy(
      await router.getAddress(), owner.address
    );
    await router.setAdapter(await adapter.getAddress());
    const consumer = await (await ethers.getContractFactory("MockRandomnessConsumer")).deploy(
      await router.getAddress()
    );
    await router.setConsumer(await consumer.getAddress(), true);
    const entropy = await (await ethers.getContractFactory("MockEntropy")).deploy();
    await entropy.setFee(FEE);
    await adapter.configure(await entropy.getAddress(), PROVIDER);
    // Prefund the adapter so it can pay Entropy's per-request fee.
    await owner.sendTransaction({ to: await adapter.getAddress(), value: ethers.parseEther("1") });
    return { owner, other, router, adapter, consumer, entropy };
  }

  it("routes a request to Entropy (paying the fee) and the word back to the consumer", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(7);
    const seq = await ctx.entropy.sequenceCounter();
    expect(await ctx.adapter.routerRequestOf(seq)).to.equal(1n);
    // fee left the adapter and landed on the entropy contract
    expect(await ethers.provider.getBalance(await ctx.entropy.getAddress())).to.equal(FEE);
    // the user contribution was committed alongside the request
    expect(await ctx.entropy.userRandomOf(seq)).to.not.equal(ethers.ZeroHash);

    const word = ethers.toBeHex(12345n, 32);
    await ctx.entropy.fulfill(seq, PROVIDER, word);
    expect(await ctx.consumer.lastDrawId()).to.equal(7n);
    expect(await ctx.consumer.lastWord()).to.equal(12345n);
    // mapping cleared -> no double-fulfil
    expect(await ctx.adapter.routerRequestOf(seq)).to.equal(0n);
    await expect(ctx.entropy.fulfill(seq, PROVIDER, word)).to.be.revertedWith("PEA: unknown request");
  });

  it("only the entropy contract may deliver and only the router may request", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);
    const seq = await ctx.entropy.sequenceCounter();
    await expect(
      ctx.adapter.connect(ctx.other)._entropyCallback(seq, PROVIDER, ethers.ZeroHash)
    ).to.be.revertedWith("PEA: only entropy");
    await expect(ctx.adapter.connect(ctx.other).requestRandomness(9)).to.be.revertedWith("PEA: only router");
  });

  it("refuses to request while underfunded, works again after a top-up", async () => {
    const ctx = await loadFixture(deploy);
    // Drain the prefund: withdraw everything back to the owner.
    const bal = await ethers.provider.getBalance(await ctx.adapter.getAddress());
    await ctx.adapter.withdraw(ctx.owner.address, bal);
    await expect(ctx.consumer.request(1)).to.be.revertedWith("PEA: underfunded");

    await ctx.owner.sendTransaction({ to: await ctx.adapter.getAddress(), value: FEE });
    await expect(ctx.consumer.request(1)).to.not.be.reverted;
  });

  it("only the owner may withdraw the prefund", async () => {
    const ctx = await loadFixture(deploy);
    await expect(
      ctx.adapter.connect(ctx.other).withdraw(ctx.other.address, 1n)
    ).to.be.revertedWithCustomError(ctx.adapter, "OwnableUnauthorizedAccount");
  });

  it("blocks an entropy-contract swap while a request is outstanding, allows retuning the provider", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);
    expect(await ctx.adapter.outstanding()).to.equal(1n);

    const otherEntropy = await (await ethers.getContractFactory("MockEntropy")).deploy();
    await expect(
      ctx.adapter.configure(await otherEntropy.getAddress(), PROVIDER)
    ).to.be.revertedWith("PEA: requests outstanding");
    // same entropy contract: retuning the provider is fine mid-flight
    const otherProvider = "0x00000000000000000000000000000000000000B2";
    await expect(ctx.adapter.configure(await ctx.entropy.getAddress(), otherProvider)).to.not.be.reverted;
    expect(await ctx.adapter.provider()).to.equal(ethers.getAddress(otherProvider));

    // once fulfilled, outstanding clears and the swap is allowed
    await ctx.entropy.fulfill(await ctx.entropy.sequenceCounter(), PROVIDER, ethers.toBeHex(7n, 32));
    expect(await ctx.adapter.outstanding()).to.equal(0n);
    await expect(ctx.adapter.configure(await otherEntropy.getAddress(), PROVIDER)).to.not.be.reverted;
  });

  it("refuses requests until configured", async () => {
    const [owner] = await ethers.getSigners();
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (await ethers.getContractFactory("PythEntropyAdapter")).deploy(
      await router.getAddress(), owner.address
    );
    await router.setAdapter(await adapter.getAddress());
    const consumer = await (await ethers.getContractFactory("MockRandomnessConsumer")).deploy(
      await router.getAddress()
    );
    await router.setConsumer(await consumer.getAddress(), true);
    await expect(consumer.request(1)).to.be.revertedWith("PEA: not configured");
  });
});
