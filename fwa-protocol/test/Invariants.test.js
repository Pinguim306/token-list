const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;
const ACC = 10n ** 18n;

// Deterministic 64-bit LCG so failures reproduce exactly.
function makeRng(seed) {
  let s = BigInt(seed) & ((1n << 64n) - 1n);
  const M = (1n << 64n) - 1n;
  return () => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & M;
    return s;
  };
}

describe("FWAPool — randomized invariant testing", function () {
  async function deploy() {
    const signers = await ethers.getSigners();
    const [owner, treasury, alice, bob, carol, buyerA, buyerB] = signers;
    const backing = await (await ethers.getContractFactory("MockERC20")).deploy("USDG", "USDG", 18);
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
    for (const s of [alice, bob, carol, buyerA, buyerB]) {
      await backing.mint(s.address, 10_000_000n * WAD);
      await backing.connect(s).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    return { owner, treasury, alice, bob, carol, buyerA, buyerB, backing, nft, whitelist, router, adapter, pool };
  }

  async function runScenario(seedHex) {
    const ctx = await loadFixture(deploy);
    const poolAddr = await ctx.pool.getAddress();
    const nftAddr = await ctx.nft.getAddress();
    const depositors = [ctx.alice, ctx.bob, ctx.carol];
    const buyers = [ctx.buyerA, ctx.buyerB];
    const creditHolders = [ctx.treasury, ctx.alice, ctx.bob, ctx.carol, ctx.buyerA, ctx.buyerB].map((s) => s.address);
    const rng = makeRng(seedHex);
    const pick = (n) => Number(rng() % BigInt(n));

    const active = new Map(); // id(bigint) -> { signer, backing }
    let nextToken = 1;

    async function checkInvariants(round) {
      const count = Number(await ctx.pool.positionCount());
      const acc = await ctx.pool.accFeePerPosition();
      let sumBacking = 0n, sumWeight = 0n, sumWB = 0n, sumPending = 0n, activeN = 0n;
      for (let id = 1; id <= count; id++) {
        const p = await ctx.pool.positions(id);
        if (!p.active) continue;
        activeN += 1n;
        sumBacking += p.backing;
        sumWeight += p.weight;
        sumWB += p.weight * p.backing;
        sumPending += (acc - p.feeDebt) / ACC;
      }
      let sumCredit = 0n;
      for (const a of creditHolders) sumCredit += await ctx.pool.backingCredit(a);
      const topPot = await ctx.pool.topPot();
      const poolBal = await ctx.backing.balanceOf(poolAddr);
      const owed = sumBacking + sumCredit + topPot + sumPending;

      const ctxMsg = `round ${round}`;
      // Solvency: the pool can always cover everything owed; the gap is only accumulator dust.
      expect(poolBal, `${ctxMsg} solvency`).to.be.gte(owed);
      expect(poolBal - owed, `${ctxMsg} dust`).to.be.lt(10n ** 15n);
      // Structural
      expect(await ctx.pool.totalWeight(), `${ctxMsg} totalWeight`).to.equal(sumWeight);
      expect(await ctx.pool.weightedBackingTotal(), `${ctxMsg} wbt`).to.equal(sumWB);
      expect(await ctx.pool.activeCount(), `${ctxMsg} activeCount`).to.equal(activeN);
      // Crown references an active position (or is vacant)
      const topId = await ctx.pool.topListingId();
      if (topId !== 0n) {
        expect((await ctx.pool.positions(topId)).active, `${ctxMsg} crown active`).to.equal(true);
      }
      // JS/chain agreement on the active set size
      expect(activeN, `${ctxMsg} active set`).to.equal(BigInt(active.size));
    }

    const ROUNDS = 60;
    for (let round = 0; round < ROUNDS; round++) {
      const roll = pick(100);

      if (roll < 45 && active.size < 8) {
        // deposit
        const dep = depositors[pick(depositors.length)];
        const tokenId = nextToken++;
        const b = (1n + (rng() % 500n)) * WAD;
        await ctx.nft.mint(dep.address, tokenId);
        await ctx.nft.connect(dep).approve(poolAddr, tokenId);
        await ctx.pool.connect(dep).deposit(nftAddr, tokenId, b);
        const id = await ctx.pool.positionCount();
        active.set(id, { signer: dep, backing: b });
      } else if (roll < 80 && active.size > 0) {
        // draw + settle (Keep or SellBack)
        const buyer = buyers[pick(buyers.length)];
        await ctx.pool.connect(buyer).startDraw(ethers.MaxUint256);
        const drawId = await ctx.pool.drawCount();
        const reqId = await ctx.router.requestCounter();
        await ctx.adapter.fulfill(reqId, rng());
        const choice = pick(2);
        await ctx.pool.connect(buyer).settle(drawId, choice);
        const d = await ctx.pool.draws(drawId);
        active.delete(d.selectedId);
      } else if (roll < 92 && active.size > 0) {
        // withdraw a random active position
        const ids = [...active.keys()];
        const id = ids[pick(ids.length)];
        const { signer } = active.get(id);
        await ctx.pool.connect(signer).withdraw(id);
        active.delete(id);
      } else if (roll < 97 && active.size > 0) {
        // claim earnings on a random active position
        const ids = [...active.keys()];
        const id = ids[pick(ids.length)];
        await ctx.pool.connect(active.get(id).signer).claimEarnings(id);
      } else {
        // withdraw credit for a random actor that has any
        const all = [ctx.treasury, ctx.alice, ctx.bob, ctx.carol, ctx.buyerA, ctx.buyerB];
        const who = all[pick(all.length)];
        if ((await ctx.pool.backingCredit(who.address)) > 0n) {
          await ctx.pool.connect(who).withdrawCredit();
        }
      }

      await checkInvariants(round);
    }

    // Final drain: withdraw all remaining positions and credits, assert the pool empties to dust.
    for (const [id, { signer }] of [...active.entries()]) {
      await ctx.pool.connect(signer).withdraw(id);
      active.delete(id);
    }
    const all = [ctx.treasury, ctx.alice, ctx.bob, ctx.carol, ctx.buyerA, ctx.buyerB];
    for (const who of all) {
      if ((await ctx.pool.backingCredit(who.address)) > 0n) await ctx.pool.connect(who).withdrawCredit();
    }
    expect(await ctx.pool.activeCount()).to.equal(0n);
    expect(await ctx.pool.topListingId()).to.equal(0n);
    // Everything is withdrawn; only tiny accumulator dust may remain locked.
    expect(await ctx.backing.balanceOf(poolAddr)).to.be.lt(10n ** 15n);
  }

  for (const seed of [0xC0FFEEn, 0xDEADBEEFn, 0x1234ABCDn, 0x99A1B2n]) {
    it(`preserves solvency + structural invariants (seed 0x${seed.toString(16)})`, async () => {
      await runScenario(seed);
    });
  }
});
