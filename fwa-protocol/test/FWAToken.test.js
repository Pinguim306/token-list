const { expect } = require("chai");
const { ethers } = require("hardhat");

const WAD = 10n ** 18n;

describe("FWAToken", function () {
  let token, admin, minter, alice, dex;
  const CAP = 1_000_000n * WAD;

  beforeEach(async () => {
    [admin, minter, alice, dex] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("FWAToken")).deploy(CAP, admin.address);
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
    // transfers closed: alice (not allowlisted) cannot move to another non-allowlisted account
    await expect(token.connect(alice).transfer(dex.address, WAD)).to.be.revertedWith("FWA: transfers closed");
    // admin is launch-allowed -> allowed even while closed
    await token.connect(minter).mint(admin.address, WAD);
    await expect(token.connect(admin).transfer(alice.address, WAD)).to.not.be.reverted;
    // an explicitly allowlisted account may receive while closed
    await token.setLaunchAllowed(dex.address, true);
    await expect(token.connect(alice).transfer(dex.address, WAD)).to.not.be.reverted;
    // open the market -> anyone can transfer
    await token.openTransfers();
    await expect(token.connect(alice).transfer(minter.address, WAD)).to.not.be.reverted;
  });

  it("takes NO fee on any transfer, including DEX-style trades", async () => {
    await token.openTransfers();
    await token.connect(minter).mint(alice.address, 100n * WAD);

    // p2p transfer: full amount, no fee
    await token.connect(alice).transfer(minter.address, 10n * WAD);
    expect(await token.balanceOf(minter.address)).to.equal(10n * WAD);

    // "sell into a DEX pair" is just a transfer here — recipient gets 100%
    await token.connect(alice).transfer(dex.address, 10n * WAD);
    expect(await token.balanceOf(dex.address)).to.equal(10n * WAD);

    // conservation: nothing was skimmed anywhere
    expect(await token.balanceOf(alice.address)).to.equal(80n * WAD);
  });
});
