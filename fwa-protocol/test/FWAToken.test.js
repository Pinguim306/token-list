const { expect } = require("chai");
const { ethers } = require("hardhat");

const WAD = 10n ** 18n;

describe("FWAToken", function () {
  let token, admin, feeWallet, minter, alice, dex;
  const CAP = 1_000_000n * WAD;

  beforeEach(async () => {
    [admin, feeWallet, minter, alice, dex] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("FWAToken")).deploy(CAP, admin.address, feeWallet.address);
    await token.grantRole(await token.MINTER_ROLE(), minter.address);
  });

  it("enforces cap and minter role", async () => {
    await expect(token.connect(alice).mint(alice.address, WAD)).to.be.reverted; // not minter
    await token.connect(minter).mint(alice.address, CAP);
    await expect(token.connect(minter).mint(alice.address, 1n)).to.be.reverted; // over cap
    expect(await token.totalSupply()).to.equal(CAP);
  });

  it("gates transfers until the market is opened", async () => {
    await token.connect(minter).mint(alice.address, 100n * WAD);
    // transfers closed: alice (non-exempt) cannot move to another non-exempt account
    await expect(token.connect(alice).transfer(dex.address, WAD)).to.be.revertedWith("FWA: transfers closed");
    // admin is fee-exempt -> allowed even while closed
    await token.connect(minter).mint(admin.address, WAD);
    await expect(token.connect(admin).transfer(alice.address, WAD)).to.not.be.reverted;
    // open the market
    await token.openTransfers();
    await expect(token.connect(alice).transfer(dex.address, WAD)).to.not.be.reverted;
  });

  it("charges a 1% fee only on DEX trades", async () => {
    await token.openTransfers();
    await token.connect(minter).mint(alice.address, 100n * WAD);
    await token.setDexPair(dex.address, true);

    // normal p2p transfer: no fee
    await token.connect(alice).transfer(minter.address, 10n * WAD);
    expect(await token.balanceOf(minter.address)).to.equal(10n * WAD);

    // sell into the DEX pair: 1% fee routed to feeWallet
    await token.connect(alice).transfer(dex.address, 10n * WAD);
    const fee = (10n * WAD) / 100n;
    expect(await token.balanceOf(feeWallet.address)).to.equal(fee);
    expect(await token.balanceOf(dex.address)).to.equal(10n * WAD - fee);
  });
});
