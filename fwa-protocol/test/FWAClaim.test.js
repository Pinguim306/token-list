const { expect } = require("chai");
const { ethers } = require("hardhat");

const WAD = 10n ** 18n;

// commutative (sorted) pair hash to match OpenZeppelin MerkleProof
function hashPair(a, b) {
  const [x, y] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}
function leafOf(index, account, amount) {
  return ethers.solidityPackedKeccak256(["uint256", "address", "uint256"], [index, account, amount]);
}

describe("FWAClaim", function () {
  it("distributes via a Merkle proof and prevents double claims", async () => {
    const [admin, a, b] = await ethers.getSigners();
    const fwa = await (await ethers.getContractFactory("FWAToken")).deploy(1_000_000n * WAD, admin.address);
    await fwa.grantRole(await fwa.MINTER_ROLE(), admin.address);

    const entries = [
      { index: 0, account: a.address, amount: 100n * WAD },
      { index: 1, account: b.address, amount: 250n * WAD },
    ];
    const leaves = entries.map((e) => leafOf(e.index, e.account, e.amount));
    const root = hashPair(leaves[0], leaves[1]);

    const claim = await (await ethers.getContractFactory("FWAClaim")).deploy(await fwa.getAddress(), root, admin.address);
    // a distributor must be fee-exempt so it can pay out while the market is still gated
    await fwa.setLaunchAllowed(await claim.getAddress(), true);
    await fwa.mint(await claim.getAddress(), 350n * WAD);

    // a claims with proof [leaf1]
    await claim.claim(0, a.address, 100n * WAD, [leaves[1]]);
    expect(await fwa.balanceOf(a.address)).to.equal(100n * WAD);
    expect(await claim.isClaimed(0)).to.equal(true);

    // double claim rejected
    await expect(claim.claim(0, a.address, 100n * WAD, [leaves[1]])).to.be.revertedWith("FWAClaim: already claimed");
    // wrong amount / bad proof rejected
    await expect(claim.claim(1, b.address, 999n * WAD, [leaves[0]])).to.be.revertedWith("FWAClaim: invalid proof");

    // b claims correctly
    await claim.claim(1, b.address, 250n * WAD, [leaves[0]]);
    expect(await fwa.balanceOf(b.address)).to.equal(250n * WAD);
  });
});
