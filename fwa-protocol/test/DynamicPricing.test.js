const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;
const BPS = 10_000n;

/**
 * Dynamic dispersion pricing: when the pool skews toward cheap packs the
 * arithmetic/harmonic mean spread widens, and an owner-tunable slice of that
 * spread is added to the surcharge — capped, and OFF by default.
 */
describe("FWAPool dynamic pricing", function () {
  async function deploy() {
    const [owner, treasury, alice, buyer] = await ethers.getSigners();
    const backing = await (await ethers.getContractFactory("MockERC20")).deploy("MockUSD", "USD", 18);
    const nft = await (await ethers.getContractFactory("MockERC721")).deploy("Packs", "PACK");
    const whitelist = await (await ethers.getContractFactory("FWAWhitelist")).deploy(owner.address);
    await whitelist.setAllowed(await nft.getAddress(), true);
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (await ethers.getContractFactory("MockRandomnessAdapter")).deploy(await router.getAddress());
    await router.setAdapter(await adapter.getAddress());
    const pool = await (await ethers.getContractFactory("FWAPool")).deploy(
      await backing.getAddress(), await router.getAddress(), await whitelist.getAddress(),
      treasury.address, owner.address
    );
    await router.setConsumer(await pool.getAddress(), true);
    await backing.mint(alice.address, 1_000_000n * WAD);
    await backing.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256);
    await backing.mint(buyer.address, 1_000_000n * WAD);
    await backing.connect(buyer).approve(await pool.getAddress(), ethers.MaxUint256);
    return { owner, treasury, alice, buyer, backing, nft, pool, router, adapter };
  }

  async function deposit(ctx, tokenId, amount) {
    await ctx.nft.mint(ctx.alice.address, tokenId);
    await ctx.nft.connect(ctx.alice).approve(await ctx.pool.getAddress(), tokenId);
    await ctx.pool.connect(ctx.alice).deposit(await ctx.nft.getAddress(), tokenId, amount);
  }

  it("tracks sumBacking through deposit, withdraw and settle", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, 1, 100n * WAD);
    await deposit(ctx, 2, 300n * WAD);
    expect(await ctx.pool.sumBacking()).to.equal(400n * WAD);

    await ctx.pool.connect(ctx.alice).withdraw(1);
    expect(await ctx.pool.sumBacking()).to.equal(300n * WAD);

    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
    await ctx.pool.connect(ctx.buyer).settle(1, 0);
    expect(await ctx.pool.sumBacking()).to.equal(0n);
  });

  it("defaults off: price is exactly EV * (1 + base surcharge)", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, 1, 100n * WAD);
    await deposit(ctx, 2, 400n * WAD);
    const tw = await ctx.pool.totalWeight();
    const ev = (await ctx.pool.weightedBackingTotal()) / tw;
    const base = await ctx.pool.surchargeBps();
    expect(await ctx.pool.acquisitionPrice()).to.equal((ev * (BPS + base)) / BPS);
    expect(await ctx.pool.dynamicExtraBps(ev)).to.equal(0n);
  });

  it("uniform pool: enabling dynamic pricing adds nothing (no dispersion)", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.pool.setDynamicPricing(10_000, 3_000); // pass 100% of dispersion, cap 30%
    await deposit(ctx, 1, 100n * WAD);
    await deposit(ctx, 2, 100n * WAD);
    const tw = await ctx.pool.totalWeight();
    const ev = (await ctx.pool.weightedBackingTotal()) / tw;
    expect(await ctx.pool.dynamicExtraBps(ev)).to.equal(0n);
  });

  it("cheap-heavy pool: the extra tracks dispersion and respects the cap", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.pool.setDynamicPricing(5_000, 2_000); // 50% of dispersion, cap 20%
    // 4 cheap packs + 1 whale: harmonic mean ~24.4, arithmetic mean 208
    for (let i = 1; i <= 4; i++) await deposit(ctx, i, 10n * WAD);
    await deposit(ctx, 5, 1000n * WAD);

    const tw = await ctx.pool.totalWeight();
    const ev = (await ctx.pool.weightedBackingTotal()) / tw;
    const arith = (await ctx.pool.sumBacking()) / (await ctx.pool.activeCount());
    expect(arith > ev).to.equal(true);

    const dispersionBps = ((arith - ev) * BPS) / ev;
    const uncapped = (dispersionBps * 5_000n) / BPS;
    const expected = uncapped > 2_000n ? 2_000n : uncapped;
    expect(await ctx.pool.dynamicExtraBps(ev)).to.equal(expected);
    // with this composition the dispersion is enormous -> the cap binds
    expect(expected).to.equal(2_000n);

    const base = await ctx.pool.surchargeBps();
    expect(await ctx.pool.acquisitionPrice()).to.equal((ev * (BPS + base + expected)) / BPS);
  });

  it("startDraw escrows the dynamic price and maxPrice still protects buyers", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.pool.setDynamicPricing(10_000, 3_000);
    for (let i = 1; i <= 3; i++) await deposit(ctx, i, 10n * WAD);
    await deposit(ctx, 4, 900n * WAD);

    const price = await ctx.pool.acquisitionPrice();
    // slippage guard: a stale lower quote reverts
    await expect(ctx.pool.connect(ctx.buyer).startDraw(price - 1n)).to.be.revertedWith("FWA: slippage");
    await ctx.pool.connect(ctx.buyer).startDraw(price);
    const d = await ctx.pool.draws(1);
    expect(d.price).to.equal(price);
  });

  it("only the owner tunes it, and the cap keeps total surcharge sane", async () => {
    const ctx = await loadFixture(deploy);
    await expect(ctx.pool.connect(ctx.alice).setDynamicPricing(1, 1)).to.be.revertedWithCustomError(
      ctx.pool,
      "OwnableUnauthorizedAccount"
    );
    await expect(ctx.pool.setDynamicPricing(10_000, 9_001)).to.be.revertedWith("FWA: bps"); // base 10% + 90.01% > 100%
    await expect(ctx.pool.setDynamicPricing(10_000, 9_000)).to.not.be.reverted;
    // the factor is bounded so the pre-cap multiplication can never overflow
    await expect(ctx.pool.setDynamicPricing(100n * BPS + 1n, 1_000)).to.be.revertedWith("FWA: factor");
    await expect(ctx.pool.setDynamicPricing(0, 0)).to.not.be.reverted; // disable again
  });

  it("setParams cannot bypass the base+maxExtra cap that setDynamicPricing enforces", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.pool.setDynamicPricing(5_000, 2_000); // base 1000 + 2000 = 3000, ok
    // raising the base surcharge past (BPS - maxExtra) must revert, not silently
    // break the invariant the price ceiling depends on
    await expect(ctx.pool.setParams(8_001, 2_000, 100, 8_500, 86_400, 3_600)).to.be.revertedWith("FWA: bps");
    await expect(ctx.pool.setParams(8_000, 2_000, 100, 8_500, 86_400, 3_600)).to.not.be.reverted;
  });
});
