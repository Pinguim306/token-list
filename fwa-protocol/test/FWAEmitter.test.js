const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;

describe("FWAEmitter", function () {
  async function deploy() {
    const [owner, treasury, alice, bob, buyer] = await ethers.getSigners();
    const backing = await (await ethers.getContractFactory("MockERC20")).deploy("USDG", "USDG", 18);
    const nft = await (await ethers.getContractFactory("MockERC721")).deploy("N", "N");
    const whitelist = await (await ethers.getContractFactory("FWAWhitelist")).deploy(owner.address);
    await whitelist.setAllowed(await nft.getAddress(), true);
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (await ethers.getContractFactory("MockRandomnessAdapter")).deploy(await router.getAddress());
    await router.setAdapter(await adapter.getAddress());
    const pool = await (await ethers.getContractFactory("FWAPool")).deploy(
      await backing.getAddress(), await router.getAddress(), await whitelist.getAddress(), treasury.address, owner.address
    );
    await router.setConsumer(await pool.getAddress(), true);

    const fwa = await (await ethers.getContractFactory("FWAToken")).deploy(10n ** 9n * WAD, owner.address, owner.address);
    await fwa.grantRole(await fwa.MINTER_ROLE(), owner.address);
    const emitter = await (await ethers.getContractFactory("FWAEmitter")).deploy(await fwa.getAddress(), owner.address);
    await emitter.setPool(await pool.getAddress());
    await pool.setEmitter(await emitter.getAddress());
    await fwa.setFeeExempt(await emitter.getAddress(), true);
    await fwa.mint(await emitter.getAddress(), 1_000_000n * WAD);

    for (const s of [alice, bob, buyer]) {
      await backing.mint(s.address, 1_000_000n * WAD);
      await backing.connect(s).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    return { owner, treasury, alice, bob, buyer, backing, nft, whitelist, router, adapter, pool, fwa, emitter };
  }

  async function deposit(ctx, who, tokenId, backingAmt) {
    await ctx.nft.mint(who.address, tokenId);
    await ctx.nft.connect(who).approve(await ctx.pool.getAddress(), tokenId);
    await ctx.pool.connect(who).deposit(await ctx.nft.getAddress(), tokenId, backingAmt);
  }

  it("accrues depositor rewards proportional to sqrt(backing)", async () => {
    const ctx = await loadFixture(deploy);
    const now = await time.latest();
    const start = now + 1000;
    const R = 3n; // FWA wei per second to depositors
    await ctx.emitter.configure(start, start + 100_000, R, 0n);

    // deposits before the window opens: shares registered, no accrual yet
    await deposit(ctx, ctx.alice, 1, 100n); // sqrt = 10
    await deposit(ctx, ctx.bob, 2, 400n); //   sqrt = 20
    expect(await ctx.emitter.totalShares()).to.equal(30n);

    const T = 100n;
    await time.setNextBlockTimestamp(start + Number(T));
    await ctx.emitter.connect(ctx.alice).harvest(1); // accrues to start+T

    // pending is proportional to sqrt(backing): alice:bob = 10:20
    expect(await ctx.emitter.rewardCredit(ctx.alice.address)).to.equal((10n * R * T) / 30n); // 100
    expect(await ctx.emitter.pendingOf(2)).to.equal((20n * R * T) / 30n); // 200

    const before = await ctx.fwa.balanceOf(ctx.alice.address);
    await ctx.emitter.connect(ctx.alice).claim();
    expect(await ctx.fwa.balanceOf(ctx.alice.address)).to.equal(before + (10n * R * T) / 30n);
  });

  it("rewards purchasers a fixed amount per acquisition within the window", async () => {
    const ctx = await loadFixture(deploy);
    const now = await time.latest();
    await ctx.emitter.configure(now - 10, now + 100_000, 0n, 5n * WAD); // purchaserReward = 5 FWA
    await ctx.emitter.setPurchaserBudget(100n * WAD); // reserve budget for purchaser rewards

    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    const drawId = await ctx.pool.drawCount();
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
    await ctx.pool.connect(ctx.buyer).settle(drawId, 0); // Keep

    expect(await ctx.emitter.rewardCredit(ctx.buyer.address)).to.equal(5n * WAD);
    expect(await ctx.emitter.purchaserBudget()).to.equal(95n * WAD); // decremented
  });

  it("purchaser rewards stop once the reserved budget is exhausted (no stranding of depositor rewards)", async () => {
    const ctx = await loadFixture(deploy);
    const now = await time.latest();
    await ctx.emitter.configure(now - 10, now + 100_000, 0n, 5n * WAD);
    await ctx.emitter.setPurchaserBudget(5n * WAD); // only enough for ONE acquisition

    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    // first acquisition consumes the whole budget
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    let drawId = await ctx.pool.drawCount();
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
    await ctx.pool.connect(ctx.buyer).settle(drawId, 0);
    expect(await ctx.emitter.rewardCredit(ctx.buyer.address)).to.equal(5n * WAD);
    expect(await ctx.emitter.purchaserBudget()).to.equal(0n);

    // buyer keeps the NFT; re-deposit a fresh position and draw again
    await ctx.nft.connect(ctx.buyer).transferFrom(ctx.buyer.address, ctx.alice.address, 1);
    await ctx.nft.connect(ctx.alice).approve(await ctx.pool.getAddress(), 1);
    await ctx.pool.connect(ctx.alice).deposit(await ctx.nft.getAddress(), 1, 100n * WAD);
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    drawId = await ctx.pool.drawCount();
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
    await expect(ctx.pool.connect(ctx.buyer).settle(drawId, 0)).to.not.be.reverted;
    // budget exhausted -> no further purchaser credit accrued (still exactly one reward)
    expect(await ctx.emitter.rewardCredit(ctx.buyer.address)).to.equal(5n * WAD);
    expect(await ctx.emitter.purchaserBudget()).to.equal(0n);
  });

  it("a reverting emitter can never brick the pool (guarded hooks)", async () => {
    const ctx = await loadFixture(deploy);
    const bad = await (await ethers.getContractFactory("RevertingEmitter")).deploy();
    await ctx.pool.setEmitter(await bad.getAddress());

    // deposit still works despite emitter reverting
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    // full draw + settle still works
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    const drawId = await ctx.pool.drawCount();
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
    await expect(ctx.pool.connect(ctx.buyer).settle(drawId, 0)).to.not.be.reverted;
    expect(await ctx.nft.ownerOf(1)).to.equal(ctx.buyer.address);
    expect(await ctx.pool.drawInFlight()).to.equal(false);
  });
});
