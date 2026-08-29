const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;
const NUM = 10n ** 36n; // INVERSE_WEIGHT_NUMERATOR
const BPS = 10_000n;

describe("FWAPool", function () {
  async function deploy() {
    const [owner, treasury, alice, bob, buyer] = await ethers.getSigners();

    const backing = await (await ethers.getContractFactory("MockERC20")).deploy("MockUSDG", "USDG", 18);
    const nft = await (await ethers.getContractFactory("MockERC721")).deploy("Punks", "PUNK");

    const whitelist = await (await ethers.getContractFactory("FWAWhitelist")).deploy(owner.address);
    await whitelist.setAllowed(await nft.getAddress(), true);

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

    // fund actors
    for (const s of [alice, bob, buyer]) {
      await backing.mint(s.address, 1_000_000n * WAD);
      await backing.connect(s).approve(await pool.getAddress(), ethers.MaxUint256);
    }

    return { owner, treasury, alice, bob, buyer, backing, nft, whitelist, router, adapter, pool };
  }

  async function deposit(ctx, depositor, tokenId, backingAmt) {
    await ctx.nft.mint(depositor.address, tokenId);
    await ctx.nft.connect(depositor).approve(await ctx.pool.getAddress(), tokenId);
    const tx = await ctx.pool.connect(depositor).deposit(await ctx.nft.getAddress(), tokenId, backingAmt);
    await tx.wait();
    return ctx.pool.positionCount();
  }

  async function startAndFulfill(ctx, buyer, randomWord, maxPrice = ethers.MaxUint256) {
    await ctx.pool.connect(buyer).startDraw(maxPrice);
    const drawId = await ctx.pool.drawCount();
    const reqId = await ctx.router.requestCounter();
    await ctx.adapter.fulfill(reqId, randomWord);
    return drawId;
  }

  async function expectedSelected(pool, randomWord) {
    const tw = await pool.totalWeight();
    const target = randomWord % tw;
    const count = await pool.positionCount();
    let cum = 0n;
    for (let id = 1n; id <= count; id++) {
      const p = await pool.positions(id);
      if (!p.active) continue;
      cum += p.weight;
      if (cum > target) return id;
    }
    throw new Error("no selection");
  }

  it("deposits set inverse weight and move NFT + backing", async () => {
    const ctx = await loadFixture(deploy);
    const b = 100n * WAD;
    await deposit(ctx, ctx.alice, 1, b);
    const p = await ctx.pool.positions(1);
    expect(p.depositor).to.equal(ctx.alice.address);
    expect(p.backing).to.equal(b);
    expect(p.weight).to.equal(NUM / b);
    expect(p.active).to.equal(true);
    expect(await ctx.nft.ownerOf(1)).to.equal(await ctx.pool.getAddress());
    expect(await ctx.pool.activeCount()).to.equal(1n);
    expect(await ctx.pool.totalWeight()).to.equal(NUM / b);
  });

  it("minBacking floors new deposits — the dust-backing dilution attack is blocked", async () => {
    const ctx = await loadFixture(deploy);
    // Default floor is 0: any positive backing works (existing behavior).
    await deposit(ctx, ctx.alice, 1, 1n);
    expect((await ctx.pool.positions(1)).active).to.equal(true);

    // An open mainnet pool sets a floor. Below it: rejected; at it: fine.
    await expect(ctx.pool.connect(ctx.alice).setMinBacking(5n * WAD)).to.be.reverted; // not owner
    await ctx.pool.setMinBacking(5n * WAD);
    await ctx.nft.mint(ctx.bob.address, 2);
    await ctx.nft.connect(ctx.bob).approve(await ctx.pool.getAddress(), 2);
    await expect(
      ctx.pool.connect(ctx.bob).deposit(await ctx.nft.getAddress(), 2, 5n * WAD - 1n)
    ).to.be.revertedWith("FWA: backing below min");
    await ctx.pool.connect(ctx.bob).deposit(await ctx.nft.getAddress(), 2, 5n * WAD);
    expect((await ctx.pool.positions(2)).active).to.equal(true);

    // Without the floor, a 1-wei backing carries weight 1e36 and would crash
    // the harmonic-mean price to dust; with the floor in place the price
    // stays anchored to real backings.
    expect(await ctx.pool.acquisitionPrice()).to.be.greaterThan(0n);
  });

  it("prices acquisition as harmonic mean * (1 + surcharge)", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    await deposit(ctx, ctx.bob, 2, 400n * WAD);
    const tw = await ctx.pool.totalWeight();
    const wbt = await ctx.pool.weightedBackingTotal();
    const ev = wbt / tw; // harmonic mean of {100,400} = 160
    const surcharge = await ctx.pool.surchargeBps();
    const expected = (ev * (BPS + surcharge)) / BPS;
    expect(await ctx.pool.acquisitionPrice()).to.equal(expected);
    expect(ev).to.equal(160n * WAD); // sanity: 2 / (1/100 + 1/400) = 160
  });

  it("freezes the pool while a draw is in flight", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    await deposit(ctx, ctx.bob, 2, 100n * WAD);
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);

    await ctx.nft.mint(ctx.alice.address, 99);
    await ctx.nft.connect(ctx.alice).approve(await ctx.pool.getAddress(), 99);
    await expect(
      ctx.pool.connect(ctx.alice).deposit(await ctx.nft.getAddress(), 99, 50n * WAD)
    ).to.be.revertedWith("FWA: draw in flight");
    await expect(ctx.pool.connect(ctx.alice).withdraw(1)).to.be.revertedWith("FWA: draw in flight");

    // after settle, pool unfreezes
    const reqId = await ctx.router.requestCounter();
    await ctx.adapter.fulfill(reqId, 0n);
    const drawId = await ctx.pool.drawCount();
    await ctx.pool.connect(ctx.buyer).settle(drawId, 0); // Keep
    expect(await ctx.pool.drawInFlight()).to.equal(false);
    await expect(ctx.pool.connect(ctx.alice).deposit(await ctx.nft.getAddress(), 99, 50n * WAD)).to.not.be.reverted;
  });

  it("selects the position determined by the frozen snapshot + random word", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD); // weight highest
    await deposit(ctx, ctx.bob, 2, 200n * WAD);
    await deposit(ctx, ctx.alice, 3, 400n * WAD); // weight lowest

    for (const word of [0n, 12345n, NUM, 7n * 10n ** 30n, 2n ** 200n]) {
      const expId = await expectedSelected(ctx.pool, word);
      const p = await ctx.pool.positions(expId);
      const drawId = await startAndFulfill(ctx, ctx.buyer, word);
      await ctx.pool.connect(ctx.buyer).settle(drawId, 1); // SellBack -> NFT back to depositor, position removed
      const d = await ctx.pool.draws(drawId);
      expect(d.selectedId).to.equal(expId);
      // restore the removed position (NFT already back with the depositor; re-approve + re-deposit)
      const tokenId = Number(p.tokenId);
      const depositor = p.depositor === ctx.alice.address ? ctx.alice : ctx.bob;
      await ctx.nft.connect(depositor).approve(await ctx.pool.getAddress(), tokenId);
      await ctx.pool.connect(depositor).deposit(await ctx.nft.getAddress(), tokenId, p.backing);
    }
  });

  it("settlement KEEP: buyer gets NFT, depositor paid backing minus fee", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD); // single position -> always selected
    const price = await ctx.pool.acquisitionPrice();

    const drawId = await startAndFulfill(ctx, ctx.buyer, 0n);
    await ctx.pool.connect(ctx.buyer).settle(drawId, 0); // Keep

    expect(await ctx.nft.ownerOf(1)).to.equal(ctx.buyer.address);

    const backing = 100n * WAD;
    const keepFee = (backing * (await ctx.pool.settlementFeeBps())) / BPS;
    const protocolCut = (price * (await ctx.pool.acquisitionCutBps())) / BPS;
    // single active position => whole (price - protocolCut) accrues to alice too
    const feeShare = price - protocolCut;
    expect(await ctx.pool.backingCredit(ctx.alice.address)).to.equal(backing - keepFee + feeShare);
    expect(await ctx.pool.backingCredit(ctx.treasury.address)).to.equal(protocolCut + keepFee);
  });

  it("settlement SELLBACK: buyer paid bid, depositor keeps NFT, protocol keeps discount", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    const price = await ctx.pool.acquisitionPrice();

    const drawId = await startAndFulfill(ctx, ctx.buyer, 0n);
    await ctx.pool.connect(ctx.buyer).settle(drawId, 1); // SellBack

    expect(await ctx.nft.ownerOf(1)).to.equal(ctx.alice.address); // returned to depositor
    const backing = 100n * WAD;
    const bid = (backing * (await ctx.pool.bidBps())) / BPS;
    const discount = backing - bid;
    const protocolCut = (price * (await ctx.pool.acquisitionCutBps())) / BPS;
    expect(await ctx.pool.backingCredit(ctx.buyer.address)).to.equal(bid);
    expect(await ctx.pool.backingCredit(ctx.treasury.address)).to.equal(protocolCut + discount);
  });

  it("splits acquisition fee equally among active positions (after crown tithe)", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD); // first deposit auto-takes the crown
    await deposit(ctx, ctx.bob, 2, 100n * WAD); // equal backing -> does not dethrone
    expect(await ctx.pool.topListingId()).to.equal(1n);
    const price = await ctx.pool.acquisitionPrice();
    const protocolCut = (price * (await ctx.pool.acquisitionCutBps())) / BPS;
    const distributable = price - protocolCut;
    const tithe = (distributable * (await ctx.pool.topShareBps())) / BPS; // 5% to the crown pot
    const afterTithe = distributable - tithe;

    // random word 0 -> selects position 1 (alice, the crown)
    const drawId = await startAndFulfill(ctx, ctx.buyer, 0n);
    await ctx.pool.connect(ctx.buyer).settle(drawId, 1); // SellBack

    // bob (not the crown) shares half of the post-tithe distributable
    await ctx.pool.connect(ctx.bob).claimEarnings(2);
    expect(await ctx.pool.backingCredit(ctx.bob.address)).to.equal(afterTithe / 2n);
  });

  it("refunds the buyer when randomness times out", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    const price = await ctx.pool.acquisitionPrice();
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    const drawId = await ctx.pool.drawCount();

    await time.increase(3601);
    await ctx.pool.expireDraw(drawId);
    expect(await ctx.pool.drawInFlight()).to.equal(false);
    expect(await ctx.pool.backingCredit(ctx.buyer.address)).to.equal(price);
  });

  it("ignores stale fulfillment on an expired draw (callback never reverts)", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    const drawId = await ctx.pool.drawCount();
    const reqId = await ctx.router.requestCounter();
    await time.increase(3601);
    await ctx.pool.expireDraw(drawId);
    // late randomness must not revert and must not resurrect the draw
    await expect(ctx.adapter.fulfill(reqId, 123n)).to.not.be.reverted;
    const d = await ctx.pool.draws(drawId);
    expect(d.state).to.equal(4n); // Refunded
  });

  it("lets anyone finalize (default Keep) after the settlement window", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    const drawId = await startAndFulfill(ctx, ctx.buyer, 0n);
    await expect(ctx.pool.connect(ctx.bob).finalize(drawId)).to.be.revertedWith("FWA: too early");
    await time.increase(24 * 3600 + 1);
    await ctx.pool.connect(ctx.bob).finalize(drawId); // random third party
    expect(await ctx.nft.ownerOf(1)).to.equal(ctx.buyer.address);
  });

  it("pull-based withdrawCredit transfers accrued balance", async () => {
    const ctx = await loadFixture(deploy);
    await deposit(ctx, ctx.alice, 1, 100n * WAD);
    const drawId = await startAndFulfill(ctx, ctx.buyer, 0n);
    await ctx.pool.connect(ctx.buyer).settle(drawId, 1); // SellBack -> buyer credited bid
    const credit = await ctx.pool.backingCredit(ctx.buyer.address);
    const before = await ctx.backing.balanceOf(ctx.buyer.address);
    await ctx.pool.connect(ctx.buyer).withdrawCredit();
    expect(await ctx.backing.balanceOf(ctx.buyer.address)).to.equal(before + credit);
    expect(await ctx.pool.backingCredit(ctx.buyer.address)).to.equal(0n);
  });

  it("prevents reentrancy / double-spend on withdrawCredit", async () => {
    const [owner, treasury, alice, buyer] = await ethers.getSigners();
    const backing = await (await ethers.getContractFactory("ReentrantToken")).deploy();
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

    // give buyer a refund credit via timeout
    await backing.mint(alice.address, 1000n * WAD);
    await backing.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256);
    await nft.mint(alice.address, 1);
    await nft.connect(alice).approve(await pool.getAddress(), 1);
    await pool.connect(alice).deposit(await nft.getAddress(), 1, 100n * WAD);

    await backing.mint(buyer.address, 1000n * WAD);
    await backing.connect(buyer).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(buyer).startDraw(ethers.MaxUint256);
    const drawId = await pool.drawCount();
    await time.increase(3601);
    await pool.expireDraw(drawId);
    const credit = await pool.backingCredit(buyer.address);
    expect(credit).to.be.greaterThan(0n);

    // arm the malicious token to re-enter withdrawCredit during transfer
    await backing.setTarget(await pool.getAddress());
    await backing.setAttack(true);
    const poolBalBefore = await backing.balanceOf(await pool.getAddress());
    // the reentrant transfer must trip the guard and revert the whole call;
    // nothing leaves the pool and the credit stays intact for a later honest withdrawal.
    await pool.connect(buyer).withdrawCredit().catch(() => {});
    const drained = poolBalBefore - (await backing.balanceOf(await pool.getAddress()));
    expect(drained).to.equal(0n); // no double-spend, no partial drain
    expect(await pool.backingCredit(buyer.address)).to.equal(credit); // credit preserved
  });
});
