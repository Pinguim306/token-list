const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, mine } = require("@nomicfoundation/hardhat-network-helpers");

const { chainSeed, buildLinks, locateHead, tick } = require("../scripts/keeper/core");

/**
 * The keeper bot's decision core (scripts/keeper/core.js) driven against the
 * real adapter in-process. The bot is stateless — every tick re-derives the
 * active chain from the master secret plus the on-chain HeadCommitted count —
 * so these tests double as proof that a restarted bot picks up mid-chain.
 */
describe("keeper bot core", function () {
  const SECRET = ethers.keccak256(ethers.toUtf8Bytes("keeper-bot-master-secret"));
  const LEN = 6;
  const cfg = { masterSecret: SECRET, chainLength: LEN, minReveals: 2 };

  async function deploy() {
    const [owner, keeper, other] = await ethers.getSigners();

    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (
      await ethers.getContractFactory("KeeperHashChainAdapter")
    ).deploy(await router.getAddress(), keeper.address, owner.address);
    await router.setAdapter(await adapter.getAddress());

    const consumer = await (
      await ethers.getContractFactory("MockRandomnessConsumer")
    ).deploy(await router.getAddress());
    await router.setConsumer(await consumer.getAddress(), true);

    return { owner, keeper, other, router, adapter: adapter.connect(keeper), consumer };
  }

  it("commits the epoch-0 chain on a fresh adapter, then idles", async () => {
    const ctx = await loadFixture(deploy);

    const first = await tick(ctx.adapter, cfg);
    expect(first.action).to.equal("commit");
    expect(first.epoch).to.equal(0);
    const links = buildLinks(chainSeed(SECRET, 0), LEN);
    expect(await ctx.adapter.chainHead()).to.equal(links[LEN]);
    expect(await ctx.adapter.revealsRemaining()).to.equal(BigInt(LEN));

    expect((await tick(ctx.adapter, cfg)).action).to.equal("idle");
  });

  it("waits before the seed block, reveals after it", async () => {
    const ctx = await loadFixture(deploy);
    await tick(ctx.adapter, cfg); // commit

    await ctx.consumer.request(7);
    expect((await tick(ctx.adapter, cfg)).action).to.equal("wait");

    await mine(6);
    const res = await tick(ctx.adapter, cfg);
    expect(res.action).to.equal("reveal");
    expect(res.linkIndex).to.equal(LEN - 1);
    expect(await ctx.consumer.lastDrawId()).to.equal(7n);
    expect(await ctx.adapter.pendingRequestId()).to.equal(0n);
  });

  it("serves consecutive draws statelessly, walking the chain backward", async () => {
    const ctx = await loadFixture(deploy);
    await tick(ctx.adapter, cfg);

    for (let draw = 1; draw <= 3; draw++) {
      await ctx.consumer.request(draw);
      await mine(6);
      const res = await tick(ctx.adapter, cfg); // fresh derivation every time
      expect(res.action).to.equal("reveal");
      expect(res.linkIndex).to.equal(LEN - draw);
      expect(await ctx.consumer.lastDrawId()).to.equal(BigInt(draw));
    }
    expect(await ctx.adapter.revealsRemaining()).to.equal(BigInt(LEN - 3));
  });

  it("rotates to the epoch-1 chain when reveals run low", async () => {
    const ctx = await loadFixture(deploy);
    await tick(ctx.adapter, cfg);

    // burn down to below minReveals (LEN=6, minReveals=2 -> 5 draws leave 1)
    for (let draw = 1; draw <= LEN - 1; draw++) {
      await ctx.consumer.request(draw);
      await mine(6);
      await tick(ctx.adapter, cfg);
    }

    const res = await tick(ctx.adapter, cfg);
    expect(res.action).to.equal("commit");
    expect(res.epoch).to.equal(1);
    const fresh = buildLinks(chainSeed(SECRET, 1), LEN);
    expect(await ctx.adapter.chainHead()).to.equal(fresh[LEN]);
    expect(await ctx.adapter.revealsRemaining()).to.equal(BigInt(LEN));
  });

  it("skips a stale request instead of revealing", async () => {
    const ctx = await loadFixture(deploy);
    await tick(ctx.adapter, cfg);

    await ctx.consumer.request(1);
    await mine(270); // past the blockhash window

    const res = await tick(ctx.adapter, cfg);
    expect(res.action).to.equal("skip-stale");
    expect(await ctx.adapter.pendingRequestId()).to.equal(0n);
    expect(await ctx.adapter.slashableSkips()).to.equal(1n);

    // and the very next request is served normally
    await ctx.consumer.request(2);
    await mine(6);
    expect((await tick(ctx.adapter, cfg)).action).to.equal("reveal");
  });

  it("fails loudly when the head is not derivable from the secret", async () => {
    const ctx = await loadFixture(deploy);
    await tick(ctx.adapter, cfg);
    await ctx.consumer.request(1);
    await mine(6);

    const wrong = { ...cfg, masterSecret: ethers.keccak256(ethers.toUtf8Bytes("someone-elses-secret")) };
    await expect(tick(ctx.adapter, wrong)).to.be.rejectedWith(/not derivable/);
  });

  it("locateHead finds walked-back heads and rejects foreign ones", () => {
    const links = buildLinks(chainSeed(SECRET, 0), LEN);
    expect(locateHead(links, links[LEN])).to.equal(LEN);
    expect(locateHead(links, links[2])).to.equal(2);
    expect(locateHead(links, ethers.keccak256("0x1234"))).to.equal(-1);
  });
});
