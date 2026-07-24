const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;

describe("FWAPool — settlement DoS resistance", function () {
  async function deploy() {
    const [owner, treasury, alice, buyer] = await ethers.getSigners();
    const backing = await (await ethers.getContractFactory("MockERC20")).deploy("USDG", "USDG", 18);
    const nft = await (await ethers.getContractFactory("PausableMockERC721")).deploy();
    const whitelist = await (await ethers.getContractFactory("FWAWhitelist")).deploy(owner.address);
    await whitelist.setAllowed(await nft.getAddress(), true);
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (await ethers.getContractFactory("MockRandomnessAdapter")).deploy(await router.getAddress());
    await router.setAdapter(await adapter.getAddress());
    const pool = await (await ethers.getContractFactory("FWAPool")).deploy(
      await backing.getAddress(), await router.getAddress(), await whitelist.getAddress(), treasury.address, owner.address
    );
    await router.setConsumer(await pool.getAddress(), true);
    for (const s of [alice, buyer]) {
      await backing.mint(s.address, 1_000_000n * WAD);
      await backing.connect(s).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    return { owner, treasury, alice, buyer, backing, nft, whitelist, router, adapter, pool };
  }

  it("a reverting NFT transfer escrows the NFT instead of bricking the pool", async () => {
    const ctx = await loadFixture(deploy);
    // alice deposits a pausable NFT
    await ctx.nft.mint(ctx.alice.address, 1);
    await ctx.nft.connect(ctx.alice).approve(await ctx.pool.getAddress(), 1);
    await ctx.pool.connect(ctx.alice).deposit(await ctx.nft.getAddress(), 1, 100n * WAD);

    // draw + fulfill selects the only position
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    const drawId = await ctx.pool.drawCount();
    const reqId = await ctx.router.requestCounter();
    await ctx.adapter.fulfill(reqId, 0n);

    // freeze the collection right before settlement (the attack)
    await ctx.nft.setFrozen(true);

    // settle Keep: delivery reverts internally but the call SUCCEEDS and unlocks the pool
    await expect(ctx.pool.connect(ctx.buyer).settle(drawId, 0)).to.not.be.reverted;
    expect(await ctx.pool.drawInFlight()).to.equal(false);
    // NFT is escrowed to the buyer, still held by the pool
    expect(await ctx.nft.ownerOf(1)).to.equal(await ctx.pool.getAddress());
    const key = ethers.solidityPackedKeccak256(["address", "uint256"], [await ctx.nft.getAddress(), 1]);
    expect(await ctx.pool.nftClaims(key)).to.equal(ctx.buyer.address);

    // the pool is NOT bricked: a new deposit + draw works
    await ctx.nft.setFrozen(false); // unrelated future activity
    await ctx.nft.mint(ctx.alice.address, 2);
    await ctx.nft.connect(ctx.alice).approve(await ctx.pool.getAddress(), 2);
    await expect(ctx.pool.connect(ctx.alice).deposit(await ctx.nft.getAddress(), 2, 100n * WAD)).to.not.be.reverted;

    // and the buyer can pull the escrowed NFT once transfers work again
    await ctx.pool.connect(ctx.buyer).claimStuckNFT(await ctx.nft.getAddress(), 1);
    expect(await ctx.nft.ownerOf(1)).to.equal(ctx.buyer.address);
    expect(await ctx.pool.nftClaims(key)).to.equal(ethers.ZeroAddress);
  });

  it("only the rightful recipient can claim an escrowed NFT", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.nft.mint(ctx.alice.address, 1);
    await ctx.nft.connect(ctx.alice).approve(await ctx.pool.getAddress(), 1);
    await ctx.pool.connect(ctx.alice).deposit(await ctx.nft.getAddress(), 1, 100n * WAD);
    await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
    const drawId = await ctx.pool.drawCount();
    await ctx.adapter.fulfill(await ctx.router.requestCounter(), 0n);
    await ctx.nft.setFrozen(true);
    await ctx.pool.connect(ctx.buyer).settle(drawId, 0); // Keep -> escrow to buyer
    await ctx.nft.setFrozen(false);
    await expect(
      ctx.pool.connect(ctx.alice).claimStuckNFT(await ctx.nft.getAddress(), 1)
    ).to.be.revertedWith("FWA: not claimant");
  });
});
