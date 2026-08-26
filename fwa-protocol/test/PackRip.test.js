const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;
const PRICE = ethers.parseEther("0.2");
const BID_BPS = 8500n;
const WINDOW = 86_400;

/**
 * PackRip: the on-chain pack checkout with the StockRip-style sell-back paid
 * in $HFWA. Exercised against an honest V2-pair double (real reserves, real
 * K check at the 0.3% fee) so the escrow -> HFWA conversion is the same math
 * the live HyperSwap pair enforces.
 */
describe("PackRip", function () {
  async function deploy() {
    const [owner, treasury, alice, bob] = await ethers.getSigners();
    const hfwa = await (await ethers.getContractFactory("FWAToken")).deploy(100_000_000n * WAD, owner.address);
    await hfwa.grantRole(await hfwa.MINTER_ROLE(), owner.address);
    await hfwa.mint(owner.address, 100_000_000n * WAD);
    await hfwa.openTransfers();

    const whype = await (await ethers.getContractFactory("MockWHYPE")).deploy();
    const [t0, t1] =
      (await hfwa.getAddress()).toLowerCase() < (await whype.getAddress()).toLowerCase()
        ? [await hfwa.getAddress(), await whype.getAddress()]
        : [await whype.getAddress(), await hfwa.getAddress()];
    const pair = await (await ethers.getContractFactory("MockUniV2Pair")).deploy(t0, t1);

    // Seed launch-ratio liquidity: 1,000,000 HFWA + 10 WHYPE, then sync.
    await hfwa.transfer(await pair.getAddress(), 1_000_000n * WAD);
    await whype.deposit({ value: ethers.parseEther("10") });
    await whype.transfer(await pair.getAddress(), ethers.parseEther("10"));
    await pair.sync();

    const rip = await (await ethers.getContractFactory("PackRip")).deploy(
      await hfwa.getAddress(), await whype.getAddress(), await pair.getAddress(),
      treasury.address, PRICE, BID_BPS, WINDOW, owner.address
    );
    return { owner, treasury, alice, bob, hfwa, whype, pair, rip };
  }

  it("ripPacks pays the dev cut to the treasury instantly and escrows the bid share", async () => {
    const ctx = await loadFixture(deploy);
    const before = await ethers.provider.getBalance(ctx.treasury.address);
    await ctx.rip.connect(ctx.alice).ripPacks(2, { value: PRICE * 2n });
    const after = await ethers.provider.getBalance(ctx.treasury.address);

    const cost = PRICE * 2n;
    const escrowed = (cost * BID_BPS) / 10_000n;
    expect(after - before).to.equal(cost - escrowed); // 15% dev cut
    const p = await ctx.rip.pending(ctx.alice.address);
    expect(p.packs).to.equal(2n);
    expect(p.escrow).to.equal(escrowed);
    expect(await ethers.provider.getBalance(await ctx.rip.getAddress())).to.equal(escrowed);

    await expect(ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE - 1n })).to.be.revertedWith("PR: wrong value");
    await expect(ctx.rip.connect(ctx.alice).ripPacks(21, { value: PRICE * 21n })).to.be.revertedWith("PR: qty");
  });

  it("sellBack converts the escrow into HFWA bought from the pair (buy pressure)", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    const escrow = (PRICE * BID_BPS) / 10_000n;

    // Expected constant-product output at 0.3% fee.
    const rIn = ethers.parseEther("10"), rOut = 1_000_000n * WAD;
    const withFee = escrow * 997n;
    const expected = (withFee * rOut) / (rIn * 1000n + withFee);

    await expect(ctx.rip.connect(ctx.alice).sellBack(1, expected)).to.not.be.reverted;
    expect(await ctx.hfwa.balanceOf(ctx.alice.address)).to.equal(expected);
    expect((await ctx.rip.pending(ctx.alice.address)).packs).to.equal(0n);
    expect(await ethers.provider.getBalance(await ctx.rip.getAddress())).to.equal(0n);
  });

  it("keep releases the escrow to the treasury", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    const escrow = (PRICE * BID_BPS) / 10_000n;
    const before = await ethers.provider.getBalance(ctx.treasury.address);
    await ctx.rip.connect(ctx.alice).keep(1);
    expect((await ethers.provider.getBalance(ctx.treasury.address)) - before).to.equal(escrow);
    expect((await ctx.rip.pending(ctx.alice.address)).packs).to.equal(0n);
  });

  it("settles partially with proportional escrow; the last pack drains the dust", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(3, { value: PRICE * 3n });
    const total = (PRICE * 3n * BID_BPS) / 10_000n;

    await ctx.rip.connect(ctx.alice).keep(1);
    let p = await ctx.rip.pending(ctx.alice.address);
    expect(p.packs).to.equal(2n);
    expect(p.escrow).to.equal(total - total / 3n);

    await ctx.rip.connect(ctx.alice).sellBack(1, 0);
    p = await ctx.rip.pending(ctx.alice.address);
    expect(p.packs).to.equal(1n);

    await ctx.rip.connect(ctx.alice).sellBack(1, 0); // count == packs -> takes ALL remaining escrow
    expect(await ethers.provider.getBalance(await ctx.rip.getAddress())).to.equal(0n);
  });

  it("enforces the settlement window: settle closes, finalize opens (default Keep)", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(2, { value: PRICE * 2n });
    await expect(ctx.rip.finalize(ctx.alice.address)).to.be.revertedWith("PR: window open");

    await time.increase(WINDOW + 1);
    await expect(ctx.rip.connect(ctx.alice).sellBack(1, 0)).to.be.revertedWith("PR: window passed");
    await expect(ctx.rip.connect(ctx.alice).keep(1)).to.be.revertedWith("PR: window passed");

    const escrow = (PRICE * 2n * BID_BPS) / 10_000n;
    const before = await ethers.provider.getBalance(ctx.treasury.address);
    await ctx.rip.connect(ctx.bob).finalize(ctx.alice.address); // permissionless
    expect((await ethers.provider.getBalance(ctx.treasury.address)) - before).to.equal(escrow);
    expect((await ctx.rip.pending(ctx.alice.address)).packs).to.equal(0n);
  });

  it("a new rip while pending merges the batch and resets the deadline", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    await time.increase(WINDOW - 100);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    const p = await ctx.rip.pending(ctx.alice.address);
    expect(p.packs).to.equal(2n);

    // The old batch would have expired; the merged deadline keeps both alive.
    await time.increase(200);
    await expect(ctx.rip.connect(ctx.alice).sellBack(2, 0)).to.not.be.reverted;
  });

  it("sellBack respects the buyer's minOut slippage floor", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    await expect(ctx.rip.connect(ctx.alice).sellBack(1, 10n ** 30n)).to.be.revertedWith("PR: slippage");
  });

  it("quoteSellBack matches what sellBack actually delivers", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(2, { value: PRICE * 2n });
    const [escrowShare, out] = await ctx.rip.quoteSellBack(ctx.alice.address, 1);
    expect(escrowShare).to.equal((PRICE * 2n * BID_BPS) / 10_000n / 2n);
    await ctx.rip.connect(ctx.alice).sellBack(1, out); // quote is achievable as the floor
    expect(await ctx.hfwa.balanceOf(ctx.alice.address)).to.equal(out);
  });

  it("owner retunes params for future rips only; escrowed value is untouched", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    const escrowBefore = (await ctx.rip.pending(ctx.alice.address)).escrow;

    await expect(ctx.rip.connect(ctx.alice).setParams(PRICE, 5000n, WINDOW)).to.be.reverted; // not owner
    await ctx.rip.setParams(PRICE * 2n, 5000n, WINDOW);
    expect((await ctx.rip.pending(ctx.alice.address)).escrow).to.equal(escrowBefore);

    // new rips use the new price/bid
    await ctx.rip.connect(ctx.bob).ripPacks(1, { value: PRICE * 2n });
    expect((await ctx.rip.pending(ctx.bob.address)).escrow).to.equal((PRICE * 2n * 5000n) / 10_000n);
  });
});
