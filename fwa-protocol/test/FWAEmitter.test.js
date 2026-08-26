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

    const fwa = await (await ethers.getContractFactory("FWAToken")).deploy(10n ** 9n * WAD, owner.address);
    await fwa.grantRole(await fwa.MINTER_ROLE(), owner.address);
    const emitter = await (await ethers.getContractFactory("FWAEmitter")).deploy(await fwa.getAddress(), owner.address);
    await emitter.setPool(await pool.getAddress());
    await pool.setEmitter(await emitter.getAddress());
    await fwa.setLaunchAllowed(await emitter.getAddress(), true);
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

  // one acquisition by `who`, settled SellBack so the NFT returns to alice for re-deposit
  async function settleOnce(ctx, who) {
    await ctx.pool.connect(who).startDraw(ethers.MaxUint256);
    const id = await ctx.pool.drawCount();
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
    await ctx.pool.connect(who).settle(id, 1); // SellBack
  }

  async function reDeposit(ctx, tokenId) {
    await ctx.nft.connect(ctx.alice).approve(await ctx.pool.getAddress(), tokenId);
    await ctx.pool.connect(ctx.alice).deposit(await ctx.nft.getAddress(), tokenId, 100n * WAD);
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

  it("splits a day's purchaser pot pro-rata among that day's acquisitions", async () => {
    const ctx = await loadFixture(deploy);
    const now = await time.latest();
    const DAY = 24 * 3600;
    await ctx.emitter.configure(now, now + 100 * DAY, 0n, 30n * WAD); // 30 FWA/day pot
    await ctx.emitter.setPurchaserBudget(1000n * WAD);

    // day 0: buyer acquires twice, bob once (total 3 acquisitions)
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    await settleOnce(ctx, ctx.buyer); // buyer acq #1
    await reDeposit(ctx, 1);
    await settleOnce(ctx, ctx.buyer); // buyer acq #2
    await reDeposit(ctx, 1);
    await settleOnce(ctx, ctx.bob); // bob acq #1

    // cannot claim while the day is still open
    await expect(ctx.emitter.claimDay(0, ctx.buyer.address)).to.be.revertedWith("EM: day still open");

    await time.increase(DAY + 1); // close day 0

    await ctx.emitter.claimDay(0, ctx.buyer.address);
    await ctx.emitter.claimDay(0, ctx.bob.address);
    // buyer 2/3, bob 1/3 of the 30 FWA pot
    expect(await ctx.emitter.rewardCredit(ctx.buyer.address)).to.equal((30n * WAD * 2n) / 3n);
    expect(await ctx.emitter.rewardCredit(ctx.bob.address)).to.equal((30n * WAD * 1n) / 3n);
    // double claim rejected
    await expect(ctx.emitter.claimDay(0, ctx.buyer.address)).to.be.revertedWith("EM: already claimed");
    expect(await ctx.emitter.purchaserBudget()).to.equal(1000n * WAD - 30n * WAD); // whole pot spent
  });

  it("caps day-pot claims at the reserved budget (no stranding of depositor rewards)", async () => {
    const ctx = await loadFixture(deploy);
    const now = await time.latest();
    const DAY = 24 * 3600;
    await ctx.emitter.configure(now, now + 100 * DAY, 0n, 30n * WAD);
    await ctx.emitter.setPurchaserBudget(10n * WAD); // less than one day's pot

    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    await settleOnce(ctx, ctx.buyer);
    await time.increase(DAY + 1);
    await ctx.emitter.claimDay(0, ctx.buyer.address);
    // reward capped at the 10 FWA budget, not the 30 FWA pot
    expect(await ctx.emitter.rewardCredit(ctx.buyer.address)).to.equal(10n * WAD);
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
