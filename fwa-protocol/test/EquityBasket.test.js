const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;

/**
 * EquityBasket wraps fungible tokenized equities into an ERC-721 so they can
 * enter the (NFT-only) FWA pool — the StockRip packaging trick. The pool needs
 * zero changes: the basket collection is whitelisted like any other ERC-721.
 */
describe("EquityBasket", function () {
  async function deploy() {
    const [owner, alice, bob, buyer, treasury] = await ethers.getSigners();

    const tokenA = await (await ethers.getContractFactory("MockERC20")).deploy("Tokenized Apple", "tAAPL", 18);
    const tokenB = await (await ethers.getContractFactory("MockERC20")).deploy("Tokenized Tesla", "tTSLA", 18);
    const basket = await (await ethers.getContractFactory("EquityBasket")).deploy(owner.address);
    await basket.setTokenAllowed(await tokenA.getAddress(), true);
    await basket.setTokenAllowed(await tokenB.getAddress(), true);

    for (const t of [tokenA, tokenB]) {
      await t.mint(alice.address, 1_000n * WAD);
      await t.connect(alice).approve(await basket.getAddress(), ethers.MaxUint256);
    }

    // wrap() requires strictly ascending token addresses
    const pair = [tokenA, tokenB];
    const addrs = [await tokenA.getAddress(), await tokenB.getAddress()];
    const order = BigInt(addrs[0]) < BigInt(addrs[1]) ? [0, 1] : [1, 0];
    const sortedTokens = order.map((i) => pair[i]);
    const sortedAddrs = order.map((i) => addrs[i]);
    const sortedAmounts = order.map((i) => (i === 0 ? 10n * WAD : 2n * WAD)); // 10 tAAPL, 2 tTSLA

    return { owner, alice, bob, buyer, treasury, tokenA, tokenB, basket, sortedTokens, sortedAddrs, sortedAmounts };
  }

  it("wrap escrows the shares and mints the basket NFT", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.basket.connect(ctx.alice).wrap(ctx.sortedAddrs, ctx.sortedAmounts);

    expect(await ctx.basket.ownerOf(1)).to.equal(ctx.alice.address);
    expect(await ctx.basket.basketCount()).to.equal(1n);

    const contents = await ctx.basket.contentsOf(1);
    expect(contents.length).to.equal(2);
    for (let i = 0; i < 2; i++) {
      expect(contents[i].token).to.equal(ctx.sortedAddrs[i]);
      expect(contents[i].amount).to.equal(ctx.sortedAmounts[i]);
      expect(await ctx.sortedTokens[i].balanceOf(await ctx.basket.getAddress())).to.equal(ctx.sortedAmounts[i]);
    }
  });

  it("rejects malformed wraps", async () => {
    const ctx = await loadFixture(deploy);
    const [a, b] = ctx.sortedAddrs;
    const basket = ctx.basket.connect(ctx.alice);

    await expect(basket.wrap([], [])).to.be.revertedWith("EB: token count");

    // 17 legs exceeds MAX_TOKENS (count is checked before anything else)
    const seventeen = Array.from({ length: 17 }, (_, i) =>
      ethers.getAddress("0x" + (i + 1).toString(16).padStart(40, "0"))
    );
    await expect(basket.wrap(seventeen, Array(17).fill(1n))).to.be.revertedWith("EB: token count");

    await expect(basket.wrap([a, b], [WAD])).to.be.revertedWith("EB: length mismatch");
    await expect(basket.wrap([a, a], [WAD, WAD])).to.be.revertedWith("EB: unsorted or duplicate");
    await expect(basket.wrap([b, a], [WAD, WAD])).to.be.revertedWith("EB: unsorted or duplicate");
    await expect(basket.wrap([a, b], [0n, WAD])).to.be.revertedWith("EB: amount=0");

    const stranger = await (await ethers.getContractFactory("MockERC20")).deploy("Not Allowed", "NOPE", 18);
    await expect(basket.wrap([await stranger.getAddress()], [WAD])).to.be.revertedWith("EB: token not allowed");
  });

  it("unwrap burns the basket and releases the shares to the recipient", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.basket.connect(ctx.alice).wrap(ctx.sortedAddrs, ctx.sortedAmounts);

    await ctx.basket.connect(ctx.alice).unwrap(1, ctx.bob.address);
    for (let i = 0; i < 2; i++) {
      expect(await ctx.sortedTokens[i].balanceOf(ctx.bob.address)).to.equal(ctx.sortedAmounts[i]);
      expect(await ctx.sortedTokens[i].balanceOf(await ctx.basket.getAddress())).to.equal(0n);
    }
    expect((await ctx.basket.contentsOf(1)).length).to.equal(0);
    await expect(ctx.basket.ownerOf(1)).to.be.revertedWithCustomError(ctx.basket, "ERC721NonexistentToken");
    // a burned basket cannot be unwrapped again
    await expect(ctx.basket.connect(ctx.alice).unwrap(1, ctx.bob.address)).to.be.revertedWithCustomError(
      ctx.basket,
      "ERC721NonexistentToken"
    );
  });

  it("only the current basket owner can unwrap", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.basket.connect(ctx.alice).wrap(ctx.sortedAddrs, ctx.sortedAmounts);
    await expect(ctx.basket.connect(ctx.bob).unwrap(1, ctx.bob.address)).to.be.revertedWith("EB: not owner");

    // ownership moves with the ERC-721, and unwrap rights move with it
    await ctx.basket.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, 1);
    await expect(ctx.basket.connect(ctx.alice).unwrap(1, ctx.alice.address)).to.be.revertedWith("EB: not owner");
    await expect(ctx.basket.connect(ctx.bob).unwrap(1, ctx.bob.address)).to.not.be.reverted;
  });

  it("only the owner curates the equity allowlist", async () => {
    const ctx = await loadFixture(deploy);
    await expect(
      ctx.basket.connect(ctx.alice).setTokenAllowed(await ctx.tokenA.getAddress(), false)
    ).to.be.revertedWithCustomError(ctx.basket, "OwnableUnauthorizedAccount");
  });

  it("wrapped equities flow through the pool unchanged: wrap -> deposit -> draw -> settle -> unwrap", async () => {
    const ctx = await loadFixture(deploy);

    // standard pool rig with the mock adapter
    const backing = await (await ethers.getContractFactory("MockERC20")).deploy("MockUSDG", "USDG", 18);
    const whitelist = await (await ethers.getContractFactory("FWAWhitelist")).deploy(ctx.owner.address);
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(ctx.owner.address);
    const adapter = await (await ethers.getContractFactory("MockRandomnessAdapter")).deploy(await router.getAddress());
    await router.setAdapter(await adapter.getAddress());
    const pool = await (await ethers.getContractFactory("FWAPool")).deploy(
      await backing.getAddress(),
      await router.getAddress(),
      await whitelist.getAddress(),
      ctx.treasury.address,
      ctx.owner.address
    );
    await router.setConsumer(await pool.getAddress(), true);
    // the basket collection is whitelisted like any other ERC-721
    await whitelist.setAllowed(await ctx.basket.getAddress(), true);

    for (const s of [ctx.alice, ctx.buyer]) {
      await backing.mint(s.address, 1_000_000n * WAD);
      await backing.connect(s).approve(await pool.getAddress(), ethers.MaxUint256);
    }

    // wrap equities, deposit the basket as a plain NFT position
    await ctx.basket.connect(ctx.alice).wrap(ctx.sortedAddrs, ctx.sortedAmounts);
    await ctx.basket.connect(ctx.alice).approve(await pool.getAddress(), 1);
    await pool.connect(ctx.alice).deposit(await ctx.basket.getAddress(), 1, 100n * WAD);
    expect(await ctx.basket.ownerOf(1)).to.equal(await pool.getAddress());

    // draw and keep: the buyer wins the basket
    await pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    const drawId = await pool.drawCount();
    await adapter.fulfill(await router.requestCounter(), 0n);
    await pool.connect(ctx.buyer).settle(drawId, 0); // Keep
    expect(await ctx.basket.ownerOf(1)).to.equal(ctx.buyer.address);

    // the winner unwraps into the underlying tokenized equities
    await ctx.basket.connect(ctx.buyer).unwrap(1, ctx.buyer.address);
    for (let i = 0; i < 2; i++) {
      expect(await ctx.sortedTokens[i].balanceOf(ctx.buyer.address)).to.equal(ctx.sortedAmounts[i]);
    }
  });

  // ------------------------------------------------------------------- //
  //   Adversarial pass: non-reverting payout + cross-basket isolation   //
  // ------------------------------------------------------------------- //

  it("cross-basket balance isolation: unwrapping one basket leaves others intact", async () => {
    const ctx = await loadFixture(deploy);
    // two baskets share tokenA; balance-delta accounting must not conflate them
    await ctx.basket.connect(ctx.alice).wrap([ctx.sortedAddrs[0]], [10n * WAD]);
    await ctx.basket.connect(ctx.alice).wrap([ctx.sortedAddrs[0]], [5n * WAD]);
    const held = await ctx.sortedTokens[0].balanceOf(await ctx.basket.getAddress());
    expect(held).to.equal(15n * WAD);

    await ctx.basket.connect(ctx.alice).unwrap(1, ctx.alice.address);
    // basket #2 still owns its exact 5 tokens; the contract holds exactly that
    expect((await ctx.basket.contentsOf(2))[0].amount).to.equal(5n * WAD);
    expect(await ctx.sortedTokens[0].balanceOf(await ctx.basket.getAddress())).to.equal(5n * WAD);
    await expect(ctx.basket.connect(ctx.alice).unwrap(2, ctx.alice.address)).to.not.be.reverted;
    expect(await ctx.sortedTokens[0].balanceOf(await ctx.basket.getAddress())).to.equal(0n);
  });

  it("a delisted-but-healthy token still unwraps (allowlist gates wrap only)", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.basket.connect(ctx.alice).wrap(ctx.sortedAddrs, ctx.sortedAmounts);
    // owner revokes the token after it was wrapped
    await ctx.basket.setTokenAllowed(ctx.sortedAddrs[0], false);
    await expect(ctx.basket.connect(ctx.alice).unwrap(1, ctx.alice.address)).to.not.be.reverted;
    expect(await ctx.sortedTokens[0].balanceOf(ctx.alice.address)).to.equal(
      1_000n * WAD - ctx.sortedAmounts[0] + ctx.sortedAmounts[0]
    );
  });

  describe("non-reverting unwrap when a leg is paused", () => {
    async function withPausable() {
      const [owner, alice] = await ethers.getSigners();
      const good = await (await ethers.getContractFactory("MockERC20")).deploy("Tokenized Apple", "tAAPL", 18);
      const pausable = await (await ethers.getContractFactory("PausableMockERC20")).deploy("Tokenized Tesla", "tTSLA");
      const basket = await (await ethers.getContractFactory("EquityBasket")).deploy(owner.address);
      await basket.setTokenAllowed(await good.getAddress(), true);
      await basket.setTokenAllowed(await pausable.getAddress(), true);
      for (const t of [good, pausable]) {
        await t.mint(alice.address, 100n * WAD);
        await t.connect(alice).approve(await basket.getAddress(), ethers.MaxUint256);
      }
      // build the strictly-ascending wrap args
      const legs = [
        { addr: await good.getAddress(), token: good, amount: 10n * WAD },
        { addr: await pausable.getAddress(), token: pausable, amount: 4n * WAD },
      ].sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));
      await basket.connect(alice).wrap(legs.map((l) => l.addr), legs.map((l) => l.amount));
      return { owner, alice, good, pausable, basket };
    }

    it("escrows the paused leg, still delivers the healthy one, and burns the basket", async () => {
      const ctx = await withPausable();
      await ctx.pausable.setPaused(true);

      await expect(ctx.basket.connect(ctx.alice).unwrap(1, ctx.alice.address))
        .to.emit(ctx.basket, "TokenEscrowed")
        .withArgs(await ctx.pausable.getAddress(), ctx.alice.address, 4n * WAD);

      // healthy leg delivered
      expect(await ctx.good.balanceOf(ctx.alice.address)).to.equal(100n * WAD);
      // paused leg escrowed, not delivered
      expect(await ctx.pausable.balanceOf(ctx.alice.address)).to.equal(96n * WAD);
      expect(await ctx.basket.stuckToken(await ctx.pausable.getAddress(), ctx.alice.address)).to.equal(4n * WAD);
      // basket is gone regardless — no brick
      await expect(ctx.basket.ownerOf(1)).to.be.revertedWithCustomError(ctx.basket, "ERC721NonexistentToken");
    });

    it("claimStuckToken pays out once the token can transfer again", async () => {
      const ctx = await withPausable();
      await ctx.pausable.setPaused(true);
      await ctx.basket.connect(ctx.alice).unwrap(1, ctx.alice.address);

      // still paused: the claim reverts and the balance is preserved
      await expect(ctx.basket.connect(ctx.alice).claimStuckToken(await ctx.pausable.getAddress())).to.be.reverted;
      expect(await ctx.basket.stuckToken(await ctx.pausable.getAddress(), ctx.alice.address)).to.equal(4n * WAD);

      await ctx.pausable.setPaused(false);
      await expect(ctx.basket.connect(ctx.alice).claimStuckToken(await ctx.pausable.getAddress()))
        .to.emit(ctx.basket, "StuckTokenClaimed")
        .withArgs(await ctx.pausable.getAddress(), ctx.alice.address, 4n * WAD);
      expect(await ctx.pausable.balanceOf(ctx.alice.address)).to.equal(100n * WAD);
      // a second claim finds nothing
      await expect(
        ctx.basket.connect(ctx.alice).claimStuckToken(await ctx.pausable.getAddress())
      ).to.be.revertedWith("EB: nothing stuck");
    });
  });
});
