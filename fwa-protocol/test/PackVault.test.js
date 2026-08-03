const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;

/**
 * PackVault: bundle seeding + permissionless replenishment for the
 * tokenized-stock pack pool. The vault is the depositor of everything it
 * mints, so owner passthroughs cover the full depositor lifecycle.
 */
describe("PackVault", function () {
  async function deploy() {
    const [owner, buyer, alice, treasury, cranker] = await ethers.getSigners();

    const backing = await (await ethers.getContractFactory("MockERC20")).deploy("MockUSD", "USD", 18);
    const tsla = await (await ethers.getContractFactory("MockERC20")).deploy("Tokenized Tesla", "xTSLA", 18);
    const nvda = await (await ethers.getContractFactory("MockERC20")).deploy("Tokenized Nvidia", "xNVDA", 18);

    const whitelist = await (await ethers.getContractFactory("FWAWhitelist")).deploy(owner.address);
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (await ethers.getContractFactory("MockRandomnessAdapter")).deploy(await router.getAddress());
    await router.setAdapter(await adapter.getAddress());

    const pool = await (await ethers.getContractFactory("FWAPool")).deploy(
      await backing.getAddress(),
      await router.getAddress(),
      await whitelist.getAddress(),
      treasury.address,
      owner.address
    );
    await router.setConsumer(await pool.getAddress(), true);

    const basket = await (await ethers.getContractFactory("EquityBasket")).deploy(owner.address);
    await basket.setTokenAllowed(await tsla.getAddress(), true);
    await basket.setTokenAllowed(await nvda.getAddress(), true);
    await whitelist.setAllowed(await basket.getAddress(), true);

    const vault = await (await ethers.getContractFactory("PackVault")).deploy(
      await basket.getAddress(),
      await pool.getAddress(),
      await backing.getAddress(),
      owner.address
    );

    // template: 0.1 xTSLA + 0.5 xNVDA per pack, 20 USD backing (sorted ascending)
    const legs = [
      { addr: await tsla.getAddress(), amount: WAD / 10n },
      { addr: await nvda.getAddress(), amount: WAD / 2n },
    ].sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));
    await vault.setTemplate(legs.map((l) => l.addr), legs.map((l) => l.amount), 20n * WAD);

    // fund the vault inventory for 10 packs
    await tsla.mint(await vault.getAddress(), WAD); // 10 × 0.1
    await nvda.mint(await vault.getAddress(), 5n * WAD); // 10 × 0.5
    await backing.mint(await vault.getAddress(), 200n * WAD); // 10 × 20

    // a buyer with funds to rip packs
    await backing.mint(buyer.address, 10_000n * WAD);
    await backing.connect(buyer).approve(await pool.getAddress(), ethers.MaxUint256);

    return { owner, buyer, alice, treasury, cranker, backing, tsla, nvda, whitelist, router, adapter, pool, basket, vault, legs };
  }

  it("mintBundle seeds N identical packs into the pool in one tx", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.vault.mintBundle(5);

    expect(await ctx.pool.activeCount()).to.equal(5n);
    expect(await ctx.pool.positionCount()).to.equal(5n);
    // every position: depositor = vault, asset = basket, backing = 20
    for (let id = 1n; id <= 5n; id++) {
      const p = await ctx.pool.positions(id);
      expect(p.depositor).to.equal(await ctx.vault.getAddress());
      expect(p.asset).to.equal(await ctx.basket.getAddress());
      expect(p.backing).to.equal(20n * WAD);
    }
    // baskets are held by the pool; contents match the template
    expect(await ctx.basket.ownerOf(3)).to.equal(await ctx.pool.getAddress());
    const contents = await ctx.basket.contentsOf(3);
    expect(contents.length).to.equal(2);
    // inventory drained by exactly 5 packs
    expect(await ctx.backing.balanceOf(await ctx.vault.getAddress())).to.equal(100n * WAD);
  });

  it("only the owner can mint bundles or change template/policy", async () => {
    const ctx = await loadFixture(deploy);
    await expect(ctx.vault.connect(ctx.alice).mintBundle(1)).to.be.revertedWithCustomError(
      ctx.vault,
      "OwnableUnauthorizedAccount"
    );
    await expect(
      ctx.vault.connect(ctx.alice).setPolicy(3, 2, 0)
    ).to.be.revertedWithCustomError(ctx.vault, "OwnableUnauthorizedAccount");
  });

  it("rejects an unsorted or empty template, backing-as-template, and over-cap bundles", async () => {
    const ctx = await loadFixture(deploy);
    const [a, b] = ctx.legs.map((l) => l.addr);
    await expect(ctx.vault.setTemplate([b, a], [1n, 1n], WAD)).to.be.revertedWith("PV: unsorted or duplicate");
    await expect(ctx.vault.setTemplate([], [], WAD)).to.be.revertedWith("PV: bad template");
    // the backing token must not double as a template leg (would double-count inventory)
    await expect(ctx.vault.setTemplate([await ctx.backing.getAddress()], [WAD], WAD)).to.be.revertedWith(
      "PV: backing in template"
    );
    await expect(ctx.vault.mintBundle(51)).to.be.revertedWith("PV: count");
  });

  it("a shallow top-up cannot starve the pool below floor/2: emergency bypasses cooldown", async () => {
    const ctx = await loadFixture(deploy);
    // top the inventory up to 30 packs so refills after the seed are affordable
    await ctx.tsla.mint(await ctx.vault.getAddress(), 2n * WAD);
    await ctx.nvda.mint(await ctx.vault.getAddress(), 10n * WAD);
    await ctx.backing.mint(await ctx.vault.getAddress(), 400n * WAD);
    await ctx.vault.setPolicy(10, 10, 3600); // floor 10, bundle 10, 1h cooldown
    await ctx.vault.mintBundle(10);

    // one rip -> active 9; a griefer tops up want=1 and consumes the cooldown
    const rip = async (word) => {
      await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
      await ctx.adapter.fulfill(await ctx.router.requestCounter(), word);
      await ctx.pool.connect(ctx.buyer).settle(await ctx.pool.drawCount(), 0);
    };
    await rip(1n);
    await ctx.vault.connect(ctx.cranker).replenishIfNeeded(); // minted 1, cooldown now armed
    expect(await ctx.pool.activeCount()).to.equal(10n);

    // buyers drain past floor/2 -> active 4 (< 5). Cooldown has NOT elapsed, but
    // the emergency path must still let anyone refill.
    for (let i = 0; i < 6; i++) await rip(BigInt(i) * 131n);
    expect(await ctx.pool.activeCount()).to.equal(4n);
    await expect(ctx.vault.connect(ctx.cranker).replenishIfNeeded()).to.not.be.reverted;
    expect(await ctx.pool.activeCount()).to.equal(10n);
  });

  describe("replenishIfNeeded", () => {
    it("is permissionless, refills to policy when the pool dips below floor", async () => {
      const ctx = await loadFixture(deploy);
      await ctx.vault.setPolicy(4, 3, 3600); // floor 4, bundle 3, 1h cooldown
      await ctx.vault.mintBundle(4);

      // pool at floor: crank refuses
      await expect(ctx.vault.connect(ctx.cranker).replenishIfNeeded()).to.be.revertedWith("PV: pool above floor");

      // two packs get ripped -> activeCount 2 < floor 4
      for (let i = 0; i < 2; i++) {
        await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
        await ctx.adapter.fulfill(await ctx.router.requestCounter(), BigInt(i) * 7919n);
        await ctx.pool.connect(ctx.buyer).settle(await ctx.pool.drawCount(), 0);
      }
      expect(await ctx.pool.activeCount()).to.equal(2n);

      // anyone cranks; wants floor-active=2 packs (< bundleSize 3)
      await expect(ctx.vault.connect(ctx.cranker).replenishIfNeeded()).to.emit(ctx.vault, "BundleMinted");
      expect(await ctx.pool.activeCount()).to.equal(4n);

      // immediately again: cooldown blocks
      await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
      await ctx.adapter.fulfill(await ctx.router.requestCounter(), 1n);
      await ctx.pool.connect(ctx.buyer).settle(await ctx.pool.drawCount(), 0);
      await expect(ctx.vault.connect(ctx.cranker).replenishIfNeeded()).to.be.revertedWith("PV: cooldown");
      await time.increase(3601);
      await expect(ctx.vault.connect(ctx.cranker).replenishIfNeeded()).to.not.be.reverted;
    });

    it("refuses while a draw is in flight (pool frozen) and when disabled", async () => {
      const ctx = await loadFixture(deploy);
      await expect(ctx.vault.replenishIfNeeded()).to.be.revertedWith("PV: crank disabled");
      await ctx.vault.setPolicy(10, 2, 0);
      await ctx.vault.mintBundle(1);
      await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
      await expect(ctx.vault.replenishIfNeeded()).to.be.revertedWith("PV: draw in flight");
    });

    it("fails loudly when the inventory cannot fund a single pack", async () => {
      const ctx = await loadFixture(deploy);
      await ctx.vault.setPolicy(10, 5, 0);
      await ctx.vault.mintBundle(10); // exactly drains the funded inventory
      // rip one so the pool is below floor
      await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
      await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
      await ctx.pool.connect(ctx.buyer).settle(await ctx.pool.drawCount(), 0);
      await expect(ctx.vault.replenishIfNeeded()).to.be.revertedWith("PV: inventory empty");
    });
  });

  it("owner lifecycle: withdraw a position, pull credit, sweep inventory out", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.vault.mintBundle(2);

    await ctx.vault.withdrawPosition(1);
    // basket #1 back in the vault; backing accrued as pool credit
    expect(await ctx.basket.ownerOf(1)).to.equal(await ctx.vault.getAddress());
    expect(await ctx.pool.backingCredit(await ctx.vault.getAddress())).to.equal(20n * WAD);

    const before = await ctx.backing.balanceOf(await ctx.vault.getAddress());
    await ctx.vault.pullPoolCredit();
    expect(await ctx.backing.balanceOf(await ctx.vault.getAddress())).to.equal(before + 20n * WAD);

    // unwrap the recovered basket back into stock inventory, then sweep some out
    await ctx.vault.unwrapBasket(1);
    await ctx.vault.sweepToken(await ctx.tsla.getAddress(), ctx.alice.address, WAD / 10n);
    expect(await ctx.tsla.balanceOf(ctx.alice.address)).to.equal(WAD / 10n);

    await expect(ctx.vault.connect(ctx.alice).sweepToken(await ctx.tsla.getAddress(), ctx.alice.address, 1n))
      .to.be.revertedWithCustomError(ctx.vault, "OwnableUnauthorizedAccount");
  });

  it("vault packs flow through a full rip: buyer keeps and unwraps the stocks", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.vault.mintBundle(1);
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
    await ctx.pool.connect(ctx.buyer).settle(1, 0); // Keep

    expect(await ctx.basket.ownerOf(1)).to.equal(ctx.buyer.address);
    await ctx.basket.connect(ctx.buyer).unwrap(1, ctx.buyer.address);
    expect(await ctx.tsla.balanceOf(ctx.buyer.address)).to.equal(WAD / 10n);
    expect(await ctx.nvda.balanceOf(ctx.buyer.address)).to.equal(WAD / 2n);
  });
});
