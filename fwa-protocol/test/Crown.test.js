const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;
const BPS = 10_000n;

describe("FWAPool — crown / tithe", function () {
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
    for (const s of [alice, bob, buyer]) {
      await backing.mint(s.address, 1_000_000n * WAD);
      await backing.connect(s).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    return { owner, treasury, alice, bob, buyer, backing, nft, whitelist, router, adapter, pool };
  }
  async function deposit(ctx, who, tokenId, amt) {
    await ctx.nft.mint(who.address, tokenId);
    await ctx.nft.connect(who).approve(await ctx.pool.getAddress(), tokenId);
    await ctx.pool.connect(who).deposit(await ctx.nft.getAddress(), tokenId, amt);
  }

  it("first deposit takes the vacant crown; only a >threshold backing dethrones it", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    expect(await ctx.pool.topListingId()).to.equal(1n);
    expect(await ctx.pool.topBacking()).to.equal(100n * WAD);

    // equal backing does not dethrone (needs +10%)
    await deposit(ctx, ctx.bob, 2, 100n * WAD);
    expect(await ctx.pool.topListingId()).to.equal(1n);

    // 109% < 110% threshold: still no dethrone
    await deposit(ctx, ctx.bob, 3, 109n * WAD);
    expect(await ctx.pool.topListingId()).to.equal(1n);

    // 111% >= 110% threshold: dethrones to position 4
    await deposit(ctx, ctx.bob, 4, 111n * WAD);
    expect(await ctx.pool.topListingId()).to.equal(4n);
    expect(await ctx.pool.topBacking()).to.equal(111n * WAD);
  });

  it("accrues a tithe on draws and pays it to the crown holder on exit", async () => {
    const ctx = await loadFixture(deploy);
    // bob holds a heavy backing (crown, low selection weight); alice a light one
    await deposit(ctx, ctx.bob, 1, 1000n * WAD); // deposited first -> crown
    await deposit(ctx, ctx.alice, 2, 100n * WAD);
    expect(await ctx.pool.topListingId()).to.equal(1n); // bob's heavy position

    const price = await ctx.pool.acquisitionPrice();
    const protocolCut = (price * (await ctx.pool.acquisitionCutBps())) / BPS;
    const distributable = price - protocolCut;
    const tithe = (distributable * (await ctx.pool.topShareBps())) / BPS;

    // random word 0 selects position 1? cumulative: pos1 weight = 1e36/1000e18 ...
    // heavier backing = lower weight, so pos1 (bob) has the SMALLER prefix. Word 0
    // lands in the first leaf (pos1). To hit alice instead, target the tail.
    const tw = await ctx.pool.totalWeight();
    const p1 = await ctx.pool.positions(1);
    const word = p1.weight + 1n; // > pos1's cumulative -> selects pos2 (alice)

    const drawId = (async () => {
      await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
      const id = await ctx.pool.drawCount();
      await ctx.adapter.fulfill(await ctx.router.requestCounter(), word);
      return id;
    });
    const d = await drawId();
    await ctx.pool.connect(ctx.buyer).settle(d, 0); // Keep alice's NFT; pos2 closes, crown (pos1) stays

    expect(await ctx.pool.topPot()).to.equal(tithe);
    expect(await ctx.pool.topListingId()).to.equal(1n); // bob still crowned

    // bob withdraws the crown position -> reclaims backing + fee earnings + the tithe pot.
    // At draw time 2 positions were active, so pos1's fee share is (distributable - tithe)/2.
    const earnings = (distributable - tithe) / 2n;
    const before = await ctx.pool.backingCredit(ctx.bob.address);
    await ctx.pool.connect(ctx.bob).withdraw(1);
    expect((await ctx.pool.backingCredit(ctx.bob.address)) - before).to.equal(1000n * WAD + earnings + tithe);
    expect(await ctx.pool.topListingId()).to.equal(0n); // vacant again
    expect(await ctx.pool.topPot()).to.equal(0n);
  });

  it("dethroning pays the accrued pot to the outgoing incumbent", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.bob, 1, 1000n * WAD); // crown
    await deposit(ctx, ctx.alice, 2, 100n * WAD);
    // one draw selecting alice accrues a tithe to bob's pot
    const p1 = await ctx.pool.positions(1);
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    const d = await ctx.pool.drawCount();
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), p1.weight + 1n);
    await ctx.pool.connect(ctx.buyer).settle(d, 0);
    const pot = await ctx.pool.topPot();
    expect(pot).to.be.greaterThan(0n);

    // a challenger beating bob by >10% dethrones and pays bob the pot
    const before = await ctx.pool.backingCredit(ctx.bob.address);
    await deposit(ctx, ctx.alice, 3, 2000n * WAD); // >110% of 1000
    expect(await ctx.pool.topListingId()).to.equal(3n);
    expect(await ctx.pool.backingCredit(ctx.bob.address)).to.equal(before + pot);
    expect(await ctx.pool.topPot()).to.equal(0n);
  });
});
