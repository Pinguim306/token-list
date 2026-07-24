const { expect } = require("chai");
const { ethers } = require("hardhat");

const WAD = 10n ** 18n;

describe("FWAWhitelist", function () {
  it("allows, blocks stickily, and never re-allows a blocked asset", async () => {
    const [owner, other] = await ethers.getSigners();
    const wl = await (await ethers.getContractFactory("FWAWhitelist")).deploy(owner.address);
    const asset = other.address;
    await wl.setAllowed(asset, true);
    expect(await wl.isAllowed(asset)).to.equal(true);
    await wl.blockAsset(asset);
    expect(await wl.isAllowed(asset)).to.equal(false);
    await expect(wl.setAllowed(asset, true)).to.be.revertedWith("FW: blocked");
    await expect(wl.connect(other).setAllowed(asset, true)).to.be.reverted; // onlyOwner
  });
});

describe("FeeRouter", function () {
  it("splits balance across recipients by basis-point shares", async () => {
    const [owner, a, b, c] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("T", "T", 18);
    const fr = await (await ethers.getContractFactory("FeeRouter")).deploy(
      owner.address,
      [a.address, b.address, c.address],
      [7000n, 2000n, 1000n]
    );
    await token.mint(await fr.getAddress(), 1000n * WAD);
    await fr.distribute(await token.getAddress());
    expect(await token.balanceOf(a.address)).to.equal(700n * WAD);
    expect(await token.balanceOf(b.address)).to.equal(200n * WAD);
    expect(await token.balanceOf(c.address)).to.equal(100n * WAD);
  });

  it("rejects shares that do not sum to 100%", async () => {
    const [owner, a, b] = await ethers.getSigners();
    await expect(
      (await ethers.getContractFactory("FeeRouter")).deploy(owner.address, [a.address, b.address], [5000n, 4000n])
    ).to.be.revertedWith("FR: shares != BPS");
  });
});

describe("FWAFactory", function () {
  it("deploys and registers pools", async () => {
    const [owner, treasury] = await ethers.getSigners();
    const backing = await (await ethers.getContractFactory("MockERC20")).deploy("U", "U", 18);
    const wl = await (await ethers.getContractFactory("FWAWhitelist")).deploy(owner.address);
    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const factory = await (await ethers.getContractFactory("FWAFactory")).deploy(owner.address);
    const tx = await factory.createPool(
      await backing.getAddress(), await router.getAddress(), await wl.getAddress(), treasury.address, owner.address
    );
    await tx.wait();
    expect(await factory.poolsLength()).to.equal(1n);
    const pool = await factory.allPools(0);
    expect(await factory.isPool(pool)).to.equal(true);
  });
});
