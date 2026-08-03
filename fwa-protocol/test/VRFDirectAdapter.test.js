const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * VRFDirectAdapter: Chainlink VRF v2.5 (native on BNB Chain), no CCIP hop.
 * Round-trip against a mock coordinator; the router path is identical to the
 * other adapters.
 */
describe("VRFDirectAdapter", function () {
  async function deploy() {
    const [owner, other] = await ethers.getSigners();
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (await ethers.getContractFactory("VRFDirectAdapter")).deploy(
      await router.getAddress(), owner.address
    );
    await router.setAdapter(await adapter.getAddress());
    const consumer = await (await ethers.getContractFactory("MockRandomnessConsumer")).deploy(
      await router.getAddress()
    );
    await router.setConsumer(await consumer.getAddress(), true);
    const coordinator = await (await ethers.getContractFactory("MockVRFCoordinator")).deploy();
    await adapter.configure(await coordinator.getAddress(), ethers.ZeroHash, 1n, 200_000, 3);
    return { owner, other, router, adapter, consumer, coordinator };
  }

  it("routes a request to the coordinator and the word back to the consumer", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(7);
    const vrfId = await ctx.coordinator.requestCounter();
    expect(await ctx.adapter.routerRequestOf(vrfId)).to.equal(1n);

    await ctx.coordinator.fulfill(vrfId, 12345n);
    expect(await ctx.consumer.lastDrawId()).to.equal(7n);
    expect(await ctx.consumer.lastWord()).to.equal(12345n);
    // mapping cleared -> no double-fulfil
    expect(await ctx.adapter.routerRequestOf(vrfId)).to.equal(0n);
    await expect(ctx.coordinator.fulfill(vrfId, 999n)).to.be.revertedWith("VDA: unknown request");
  });

  it("only the coordinator may deliver and only the router may request", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);
    const vrfId = await ctx.coordinator.requestCounter();
    await expect(ctx.adapter.connect(ctx.other).rawFulfillRandomWords(vrfId, [1n])).to.be.revertedWith(
      "VDA: only coordinator"
    );
    await expect(ctx.adapter.connect(ctx.other).requestRandomness(9)).to.be.revertedWith("VDA: only router");
  });

  it("blocks a coordinator swap while a request is outstanding, allows retuning the rest", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);
    expect(await ctx.adapter.outstanding()).to.equal(1n);

    const other = await (await ethers.getContractFactory("MockVRFCoordinator")).deploy();
    await expect(
      ctx.adapter.configure(await other.getAddress(), ethers.ZeroHash, 1n, 200_000, 3)
    ).to.be.revertedWith("VDA: requests outstanding");
    // same coordinator: retuning keyHash/gas is fine mid-flight
    await expect(
      ctx.adapter.configure(await ctx.coordinator.getAddress(), ethers.ZeroHash, 2n, 300_000, 5)
    ).to.not.be.reverted;

    // once fulfilled, outstanding clears and the swap is allowed
    await ctx.coordinator.fulfill(await ctx.coordinator.requestCounter(), 7n);
    expect(await ctx.adapter.outstanding()).to.equal(0n);
    await expect(
      ctx.adapter.configure(await other.getAddress(), ethers.ZeroHash, 1n, 200_000, 3)
    ).to.not.be.reverted;
  });

  it("refuses requests until configured", async () => {
    const [owner] = await ethers.getSigners();
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (await ethers.getContractFactory("VRFDirectAdapter")).deploy(
      await router.getAddress(), owner.address
    );
    await router.setAdapter(await adapter.getAddress());
    const consumer = await (await ethers.getContractFactory("MockRandomnessConsumer")).deploy(
      await router.getAddress()
    );
    await router.setConsumer(await consumer.getAddress(), true);
    await expect(consumer.request(1)).to.be.revertedWith("VDA: not configured");
  });
});
