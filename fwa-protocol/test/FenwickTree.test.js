const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FenwickTree", function () {
  let ft;
  beforeEach(async () => {
    ft = await (await ethers.getContractFactory("FenwickHarness")).deploy();
  });

  it("tracks total and prefix sums", async () => {
    await ft.update(1, 5);
    await ft.update(2, 3);
    await ft.update(3, 7);
    expect(await ft.total()).to.equal(15n);
    expect(await ft.prefixSum(1)).to.equal(5n);
    expect(await ft.prefixSum(2)).to.equal(8n);
    expect(await ft.prefixSum(3)).to.equal(15n);
    expect(await ft.size()).to.equal(3n);
  });

  it("selects the leaf whose cumulative range contains the target", async () => {
    // weights: [5, 3, 7] -> cumulative boundaries: [0,5) ->1, [5,8) ->2, [8,15) ->3
    await ft.update(1, 5);
    await ft.update(2, 3);
    await ft.update(3, 7);
    const cases = [
      [0, 1], [4, 1],
      [5, 2], [7, 2],
      [8, 3], [14, 3],
    ];
    for (const [target, expected] of cases) {
      expect(await ft.findByPrefix(target)).to.equal(BigInt(expected));
    }
  });

  it("skips lazily-deleted (zero-weight) leaves", async () => {
    await ft.update(1, 5);
    await ft.update(2, 3);
    await ft.update(3, 7);
    await ft.update(2, -3); // delete leaf 2
    expect(await ft.total()).to.equal(12n);
    // boundaries now: [0,5)->1, [5,12)->3 ; leaf 2 never selected
    expect(await ft.findByPrefix(4)).to.equal(1n);
    expect(await ft.findByPrefix(5)).to.equal(3n);
    expect(await ft.findByPrefix(11)).to.equal(3n);
  });

  it("handles large power-of-two-ish sizes correctly", async () => {
    const weights = [10n, 1n, 100n, 5n, 50n, 2n, 8n, 20n, 3n]; // 9 leaves
    let cum = 0n;
    const bounds = [];
    for (let i = 0; i < weights.length; i++) {
      await ft.update(i + 1, weights[i]);
      bounds.push([cum, cum + weights[i], i + 1]);
      cum += weights[i];
    }
    expect(await ft.total()).to.equal(cum);
    // check a target inside each leaf's range
    for (const [lo, hi, idx] of bounds) {
      const mid = lo + (hi - lo) / 2n;
      expect(await ft.findByPrefix(mid)).to.equal(BigInt(idx));
      expect(await ft.findByPrefix(lo)).to.equal(BigInt(idx));
      expect(await ft.findByPrefix(hi - 1n)).to.equal(BigInt(idx));
    }
  });
});
