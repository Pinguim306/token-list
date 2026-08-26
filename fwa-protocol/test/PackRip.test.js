const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;
const PRICE = ethers.parseEther("0.2");
const BID_BPS = 8500n;
const WINDOW = 86_400;

// HyperCore read precompile addresses (mirrored from PackRip).
const SPOT_PX = "0x0000000000000000000000000000000000000808";
const BBO = "0x000000000000000000000000000000000000080e";
const BBO_OFFSET = 10_000;

// HYPE/USDC spot market on chain 999: pair @107, szDecimals 2 -> scale 1e6.
const HYPE_INDEX = 107;
const HYPE_RAW = 81_900_000n; // $81.90
const HYPE_E8 = (HYPE_RAW * 10n ** 8n) / 10n ** 6n;
// A dStock market shaped like MU/USDC: pair @333, szDecimals 4 -> scale 1e4.
const STOCK_INDEX = 333;
const STOCK_RAW = 9_357_400n; // $935.74
const STOCK_E8 = (STOCK_RAW * 10n ** 8n) / 10n ** 4n;

/**
 * PackRip: the on-chain pack checkout with three real settlements — Keep
 * (PackCards collectible + escrow to treasury), Sell-back paid in $HFWA
 * (exercised against an honest V2-pair double: real reserves, real K check at
 * the 0.3% fee), and Take-the-shares (dStock tokens from inventory at the
 * live HyperCore price, read through the spotPx/BBO precompiles — their mocks
 * are installed AT the real precompile addresses via hardhat_setCode, so the
 * contract's raw staticcall shape is what's tested).
 */
describe("PackRip", function () {
  async function installPrecompiles() {
    // Deploy the mocks normally, copy their runtime code onto the precompile
    // addresses, then drive prices by calling setters ON those addresses
    // (writes land in the precompile address's own storage).
    const spotDeployed = await (await ethers.getContractFactory("MockSpotPx")).deploy();
    const bboDeployed = await (await ethers.getContractFactory("MockBbo")).deploy();
    await network.provider.send("hardhat_setCode", [
      SPOT_PX, await ethers.provider.getCode(await spotDeployed.getAddress()),
    ]);
    await network.provider.send("hardhat_setCode", [
      BBO, await ethers.provider.getCode(await bboDeployed.getAddress()),
    ]);
    const spot = await ethers.getContractAt("MockSpotPx", SPOT_PX);
    const bbo = await ethers.getContractAt("MockBbo", BBO);
    await spot.setPx(HYPE_INDEX, HYPE_RAW);
    await spot.setPx(STOCK_INDEX, STOCK_RAW);
    // Tight books around spot by default (guards inactive).
    await bbo.setBbo(BBO_OFFSET + HYPE_INDEX, HYPE_RAW, HYPE_RAW + 1000n);
    await bbo.setBbo(BBO_OFFSET + STOCK_INDEX, STOCK_RAW - 1000n, STOCK_RAW);
    return { spot, bbo };
  }

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

    const cards = await (await ethers.getContractFactory("PackCards")).deploy(owner.address);
    const rip = await (await ethers.getContractFactory("PackRip")).deploy(
      await hfwa.getAddress(), await whype.getAddress(), await pair.getAddress(), await cards.getAddress(),
      treasury.address, PRICE, BID_BPS, WINDOW, owner.address
    );
    await cards.setMinter(await rip.getAddress());

    const { spot, bbo } = await installPrecompiles();

    // A deliverable dStock (18 decimals, like every HyperCore-linked dStock)
    // with inventory pre-funded into the checkout.
    const stock = await (await ethers.getContractFactory("MockERC20")).deploy("Micron (dStock)", "MUd", 18);
    await rip.setStock(await stock.getAddress(), STOCK_INDEX, 10n ** 4n, true);
    await stock.mint(await rip.getAddress(), 100n * WAD);

    return { owner, treasury, alice, bob, hfwa, whype, pair, rip, cards, stock, spot, bbo };
  }

  const ESCROW1 = (PRICE * BID_BPS) / 10_000n; // one pack's escrow
  const sharesFor = (escrow, hypeE8 = HYPE_E8, stockE8 = STOCK_E8) => (escrow * hypeE8) / stockE8;

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

    // Expected constant-product output at 0.3% fee.
    const rIn = ethers.parseEther("10"), rOut = 1_000_000n * WAD;
    const withFee = ESCROW1 * 997n;
    const expected = (withFee * rOut) / (rIn * 1000n + withFee);

    await expect(ctx.rip.connect(ctx.alice).sellBack(1, expected)).to.not.be.reverted;
    expect(await ctx.hfwa.balanceOf(ctx.alice.address)).to.equal(expected);
    expect((await ctx.rip.pending(ctx.alice.address)).packs).to.equal(0n);
    expect(await ethers.provider.getBalance(await ctx.rip.getAddress())).to.equal(0n);
  });

  it("keep releases the escrow to the treasury and mints a card tagged with the drawn stock", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    const before = await ethers.provider.getBalance(ctx.treasury.address);
    await ctx.rip.connect(ctx.alice).keep([await ctx.stock.getAddress()]);
    expect((await ethers.provider.getBalance(ctx.treasury.address)) - before).to.equal(ESCROW1);
    expect((await ctx.rip.pending(ctx.alice.address)).packs).to.equal(0n);

    expect(await ctx.cards.balanceOf(ctx.alice.address)).to.equal(1n);
    expect(await ctx.cards.ownerOf(1n)).to.equal(ctx.alice.address);
    expect(await ctx.cards.stockOf(1n)).to.equal(await ctx.stock.getAddress());
  });

  it("keep rejects unallowed stock tags, and only PackRip may mint cards", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    await expect(ctx.rip.connect(ctx.alice).keep([ctx.bob.address])).to.be.revertedWith("PR: stock");
    await expect(ctx.cards.connect(ctx.alice).mint(ctx.alice.address, ctx.bob.address)).to.be.revertedWith(
      "PC: not minter"
    );
  });

  it("takeShares delivers the escrow's value in stock tokens at the HyperCore price", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    const expected = sharesFor(ESCROW1);

    const before = await ethers.provider.getBalance(ctx.treasury.address);
    await expect(ctx.rip.connect(ctx.alice).takeShares(1, await ctx.stock.getAddress(), expected))
      .to.emit(ctx.rip, "SharesTaken")
      .withArgs(ctx.alice.address, 1n, ESCROW1, await ctx.stock.getAddress(), expected, STOCK_E8, HYPE_E8);

    expect(await ctx.stock.balanceOf(ctx.alice.address)).to.equal(expected);
    expect((await ethers.provider.getBalance(ctx.treasury.address)) - before).to.equal(ESCROW1);
    expect((await ctx.rip.pending(ctx.alice.address)).packs).to.equal(0n);
    expect(await ethers.provider.getBalance(await ctx.rip.getAddress())).to.equal(0n);
  });

  it("takeShares prices conservatively: stock at max(spot, ask), HYPE at min(spot, bid)", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(2, { value: PRICE * 2n });

    // A manipulated-looking book: stock ask 5% above spot, HYPE bid 2% below.
    const askRaw = (STOCK_RAW * 105n) / 100n;
    const bidRaw = (HYPE_RAW * 98n) / 100n;
    await ctx.bbo.setBbo(BBO_OFFSET + STOCK_INDEX, STOCK_RAW - 1000n, askRaw);
    await ctx.bbo.setBbo(BBO_OFFSET + HYPE_INDEX, bidRaw, HYPE_RAW + 1000n);

    const askE8 = (askRaw * 10n ** 8n) / 10n ** 4n;
    const bidE8 = (bidRaw * 10n ** 8n) / 10n ** 6n;
    const expected = sharesFor(ESCROW1, bidE8, askE8); // fewer shares than at spot

    const [, quoted] = await ctx.rip.quoteTakeShares(ctx.alice.address, 1, await ctx.stock.getAddress());
    expect(quoted).to.equal(expected);
    expect(quoted).to.be.lessThan(sharesFor(ESCROW1));

    await ctx.rip.connect(ctx.alice).takeShares(1, await ctx.stock.getAddress(), expected);
    expect(await ctx.stock.balanceOf(ctx.alice.address)).to.equal(expected);

    // An empty book (zero bbo) falls back to spotPx alone.
    await ctx.bbo.setBbo(BBO_OFFSET + STOCK_INDEX, 0, 0);
    await ctx.bbo.setBbo(BBO_OFFSET + HYPE_INDEX, 0, 0);
    const [, quoted2] = await ctx.rip.quoteTakeShares(ctx.alice.address, 1, await ctx.stock.getAddress());
    expect(quoted2).to.equal(sharesFor(ESCROW1));
  });

  it("takeShares enforces minShares, inventory, and the stock allowlist", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    const stockAddr = await ctx.stock.getAddress();

    await expect(ctx.rip.connect(ctx.alice).takeShares(1, stockAddr, 10n ** 30n)).to.be.revertedWith("PR: slippage");
    await expect(ctx.rip.connect(ctx.alice).takeShares(1, ctx.bob.address, 0)).to.be.revertedWith("PR: stock");

    // Drain the inventory -> delivery must revert, escrow stays intact.
    await ctx.rip.rescueToken(stockAddr, ctx.owner.address, 100n * WAD);
    await expect(ctx.rip.connect(ctx.alice).takeShares(1, stockAddr, 0)).to.be.revertedWith("PR: inventory");
    expect((await ctx.rip.pending(ctx.alice.address)).packs).to.equal(1n);

    // Retiring the stock blocks it too.
    await ctx.stock.mint(await ctx.rip.getAddress(), 100n * WAD);
    await ctx.rip.setStock(stockAddr, STOCK_INDEX, 10n ** 4n, false);
    await expect(ctx.rip.connect(ctx.alice).takeShares(1, stockAddr, 0)).to.be.revertedWith("PR: stock");
  });

  it("quoteTakeShares matches delivery and reports the live inventory", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(2, { value: PRICE * 2n });
    const stockAddr = await ctx.stock.getAddress();

    const [escrowShare, sharesOut, stockPxE8, hypePxE8, inventory] = await ctx.rip.quoteTakeShares(
      ctx.alice.address, 1, stockAddr
    );
    expect(escrowShare).to.equal(ESCROW1);
    expect(stockPxE8).to.equal(STOCK_E8);
    expect(hypePxE8).to.equal(HYPE_E8);
    expect(inventory).to.equal(100n * WAD);

    await ctx.rip.connect(ctx.alice).takeShares(1, stockAddr, sharesOut);
    expect(await ctx.stock.balanceOf(ctx.alice.address)).to.equal(sharesOut);
  });

  it("setStock validates decimals and scale; setHypeMarket retargets the escrow pricing", async () => {
    const ctx = await loadFixture(deploy);
    const sixDec = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
    await expect(ctx.rip.setStock(await sixDec.getAddress(), 1, 10n ** 4n, true)).to.be.revertedWith("PR: decimals");
    await expect(
      ctx.rip.setStock(await ctx.stock.getAddress(), STOCK_INDEX, 10n ** 9n, true)
    ).to.be.revertedWith("PR: scale");
    await expect(
      ctx.rip.connect(ctx.alice).setStock(await ctx.stock.getAddress(), STOCK_INDEX, 10n ** 4n, true)
    ).to.be.reverted; // not owner

    // Retarget HYPE valuation at a hypothetical new market at half the price:
    // the same escrow buys half the shares.
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    await ctx.spot.setPx(500, HYPE_RAW / 2n);
    await ctx.bbo.setBbo(BBO_OFFSET + 500, 0, 0);
    await ctx.rip.setHypeMarket(500, 10n ** 6n);
    const [, sharesOut] = await ctx.rip.quoteTakeShares(ctx.alice.address, 1, await ctx.stock.getAddress());
    expect(sharesOut).to.equal(sharesFor(ESCROW1, HYPE_E8 / 2n));
  });

  it("settles partially with proportional escrow; the last pack drains the dust", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(3, { value: PRICE * 3n });
    const total = (PRICE * 3n * BID_BPS) / 10_000n;

    await ctx.rip.connect(ctx.alice).keep([await ctx.stock.getAddress()]);
    let p = await ctx.rip.pending(ctx.alice.address);
    expect(p.packs).to.equal(2n);
    expect(p.escrow).to.equal(total - total / 3n);

    await ctx.rip.connect(ctx.alice).takeShares(1, await ctx.stock.getAddress(), 0);
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
    await expect(ctx.rip.connect(ctx.alice).keep([await ctx.stock.getAddress()])).to.be.revertedWith(
      "PR: window passed"
    );
    await expect(
      ctx.rip.connect(ctx.alice).takeShares(1, await ctx.stock.getAddress(), 0)
    ).to.be.revertedWith("PR: window passed");

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

  it("rescueToken lets the owner withdraw inventory; native escrow stays out of reach", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.rip.connect(ctx.alice).ripPacks(1, { value: PRICE });
    const stockAddr = await ctx.stock.getAddress();

    await expect(ctx.rip.connect(ctx.alice).rescueToken(stockAddr, ctx.alice.address, 1n)).to.be.reverted; // not owner
    await ctx.rip.rescueToken(stockAddr, ctx.owner.address, 40n * WAD);
    expect(await ctx.stock.balanceOf(ctx.owner.address)).to.equal(40n * WAD);

    // The buyer's escrow (native HYPE) has no owner-reachable exit: it can
    // only leave through the buyer's settle or the post-window finalize.
    expect(await ethers.provider.getBalance(await ctx.rip.getAddress())).to.equal(ESCROW1);
  });
});
