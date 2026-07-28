const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-network-helpers");

const WAD = 10n ** 18n;

/**
 * Keeper hash-chain + future-blockhash randomness (the StockRip scheme):
 * chain links fixed at commit time, blockhash(seedBlock) unknown at request
 * time, word = keccak256(preimage, keccak256(requestId, blockhash), requestId).
 */
describe("KeeperHashChainAdapter", function () {
  const CHAIN_LEN = 10;

  /** links[0] is the deepest secret; links[CHAIN_LEN] is the committed head.
   *  Reveals consume links[CHAIN_LEN-1], links[CHAIN_LEN-2], ... */
  function buildChain(seed, length) {
    const links = [seed];
    for (let i = 0; i < length; i++) links.push(ethers.keccak256(links[i]));
    return links;
  }

  async function expectedWord(reqId, seedBlock, preimage) {
    const bh = (await ethers.provider.getBlock(Number(seedBlock))).hash;
    const userSeed = ethers.solidityPackedKeccak256(["uint256", "bytes32"], [reqId, bh]);
    return BigInt(ethers.solidityPackedKeccak256(["bytes32", "bytes32", "uint256"], [preimage, userSeed, reqId]));
  }

  async function deploy() {
    const [owner, keeper, other, buyer] = await ethers.getSigners();

    const router = await (await ethers.getContractFactory("RandomnessRouter")).deploy(owner.address);
    const adapter = await (
      await ethers.getContractFactory("KeeperHashChainAdapter")
    ).deploy(await router.getAddress(), keeper.address, owner.address);
    await router.setAdapter(await adapter.getAddress());

    const consumer = await (
      await ethers.getContractFactory("MockRandomnessConsumer")
    ).deploy(await router.getAddress());
    await router.setConsumer(await consumer.getAddress(), true);

    const links = buildChain(ethers.keccak256(ethers.toUtf8Bytes("fwa-keeper-chain-seed")), CHAIN_LEN);
    await adapter.connect(keeper).commitHead(links[CHAIN_LEN], CHAIN_LEN);

    return { owner, keeper, other, buyer, router, adapter, consumer, links };
  }

  /** Request a word for drawId and reveal links[revealIdx] after the seed block. */
  async function requestAndReveal(ctx, drawId, revealIdx) {
    await ctx.consumer.request(drawId);
    const reqId = await ctx.router.requestCounter();
    const seedBlock = await ctx.adapter.seedBlock();
    await mine(6); // seed block (request + 5) is now history
    const preimage = ctx.links[revealIdx];
    await ctx.adapter.connect(ctx.keeper).reveal(preimage);
    return { reqId, seedBlock, preimage };
  }

  it("only the keeper commits heads, and never over a pending request", async () => {
    const ctx = await loadFixture(deploy);
    await expect(ctx.adapter.connect(ctx.other).commitHead(ctx.links[CHAIN_LEN], 1)).to.be.revertedWith(
      "KHC: not keeper"
    );
    await expect(ctx.adapter.connect(ctx.keeper).commitHead(ethers.ZeroHash, 1)).to.be.revertedWith(
      "KHC: empty chain"
    );
    await expect(ctx.adapter.connect(ctx.keeper).commitHead(ctx.links[CHAIN_LEN], 0)).to.be.revertedWith(
      "KHC: empty chain"
    );

    await ctx.consumer.request(1);
    await expect(ctx.adapter.connect(ctx.keeper).commitHead(ctx.links[CHAIN_LEN], CHAIN_LEN)).to.be.revertedWith(
      "KHC: pending"
    );
  });

  it("only the router may request randomness", async () => {
    const ctx = await loadFixture(deploy);
    await expect(ctx.adapter.connect(ctx.other).requestRandomness(1)).to.be.revertedWith("KHC: only router");
  });

  it("delivers keccak256(preimage, keccak256(requestId, blockhash(seedBlock)), requestId)", async () => {
    const ctx = await loadFixture(deploy);
    const { reqId, seedBlock, preimage } = await requestAndReveal(ctx, 42, CHAIN_LEN - 1);

    expect(await ctx.consumer.fulfillments()).to.equal(1n);
    expect(await ctx.consumer.lastDrawId()).to.equal(42n);
    expect(await ctx.consumer.lastWord()).to.equal(await expectedWord(reqId, seedBlock, preimage));

    // head walked backward, one reveal burned, pending slot cleared
    expect(await ctx.adapter.chainHead()).to.equal(preimage);
    expect(await ctx.adapter.revealsRemaining()).to.equal(BigInt(CHAIN_LEN - 1));
    expect(await ctx.adapter.pendingRequestId()).to.equal(0n);
  });

  it("rejects a reveal before the seed block is history", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);
    // seed block is request + 5; without mining, we are still before it
    await expect(ctx.adapter.connect(ctx.keeper).reveal(ctx.links[CHAIN_LEN - 1])).to.be.revertedWith(
      "KHC: too early"
    );
  });

  it("rejects a preimage that does not hash to the head", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);
    await mine(6);
    // links[CHAIN_LEN - 2] is one link too deep — hashing it gives links[CHAIN_LEN-1], not the head
    await expect(ctx.adapter.connect(ctx.keeper).reveal(ctx.links[CHAIN_LEN - 2])).to.be.revertedWith(
      "KHC: bad preimage"
    );
    await expect(ctx.adapter.connect(ctx.other).reveal(ctx.links[CHAIN_LEN - 1])).to.be.revertedWith(
      "KHC: not keeper"
    );
  });

  it("serializes requests: a second request while one is pending reverts", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);
    await expect(ctx.consumer.request(2)).to.be.revertedWith("KHC: pending");
  });

  it("walks the chain strictly backward across draws; replayed preimages fail", async () => {
    const ctx = await loadFixture(deploy);
    await requestAndReveal(ctx, 1, CHAIN_LEN - 1);

    await ctx.consumer.request(2);
    await mine(6);
    // replaying the already-revealed link must fail (it IS the head now; its hash is not)
    await expect(ctx.adapter.connect(ctx.keeper).reveal(ctx.links[CHAIN_LEN - 1])).to.be.revertedWith(
      "KHC: bad preimage"
    );
    await ctx.adapter.connect(ctx.keeper).reveal(ctx.links[CHAIN_LEN - 2]);
    expect(await ctx.consumer.lastDrawId()).to.equal(2n);
    expect(await ctx.adapter.revealsRemaining()).to.equal(BigInt(CHAIN_LEN - 2));
  });

  it("an exhausted chain refuses new requests until a fresh head is committed", async () => {
    const ctx = await loadFixture(deploy);
    // shrink to a 1-reveal chain
    await ctx.adapter.connect(ctx.keeper).commitHead(ctx.links[1], 1);
    await ctx.consumer.request(1);
    await mine(6);
    await ctx.adapter.connect(ctx.keeper).reveal(ctx.links[0]);

    await expect(ctx.consumer.request(2)).to.be.revertedWith("KHC: chain exhausted");

    const fresh = buildChain(ethers.keccak256(ethers.toUtf8Bytes("fresh-chain")), 3);
    await ctx.adapter.connect(ctx.keeper).commitHead(fresh[3], 3);
    await expect(ctx.consumer.request(2)).to.not.be.reverted;
  });

  it("stale seed: reveal reverts, skipStale unblocks and records a slashable skip", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);

    await expect(ctx.adapter.skipStale()).to.be.revertedWith("KHC: not stale");

    await mine(270); // past seedBlock + 256: blockhash(seedBlock) is gone
    await expect(ctx.adapter.connect(ctx.keeper).reveal(ctx.links[CHAIN_LEN - 1])).to.be.revertedWith(
      "KHC: stale seed"
    );

    await ctx.adapter.connect(ctx.other).skipStale(); // permissionless
    expect(await ctx.adapter.pendingRequestId()).to.equal(0n);
    expect(await ctx.adapter.slashableSkips()).to.equal(1n);
    // the chain head was NOT consumed and the adapter serves the next draw
    await requestAndReveal(ctx, 2, CHAIN_LEN - 1);
    expect(await ctx.consumer.lastDrawId()).to.equal(2n);
  });

  it("no double-serve: a late reveal after skipStale cannot resurrect the request", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.consumer.request(1);
    await mine(270);
    await ctx.adapter.connect(ctx.other).skipStale();

    // keeper resurfaces and tries to reveal the skipped request — the pending
    // slot is empty, so there is nothing to fulfil and the consumer is untouched.
    await expect(ctx.adapter.connect(ctx.keeper).reveal(ctx.links[CHAIN_LEN - 1])).to.be.revertedWith(
      "KHC: no pending"
    );
    expect(await ctx.consumer.fulfillments()).to.equal(0n);
  });

  it("each stale skip needs its own slash to unlock the bond", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.adapter.connect(ctx.keeper).postBond({ value: WAD });

    // two separate outages -> two recorded skips
    for (let d = 1; d <= 2; d++) {
      await ctx.consumer.request(d);
      await mine(270);
      await ctx.adapter.skipStale();
    }
    expect(await ctx.adapter.slashableSkips()).to.equal(2n);

    await ctx.adapter.connect(ctx.owner).slash(ctx.buyer.address, 0n); // forgive one
    await expect(ctx.adapter.connect(ctx.keeper).withdrawBond(WAD)).to.be.revertedWith("KHC: slashable skip");
    await ctx.adapter.connect(ctx.owner).slash(ctx.buyer.address, 0n); // forgive the second
    await expect(ctx.adapter.connect(ctx.keeper).withdrawBond(WAD)).to.not.be.reverted;
  });

  it("bond: locked while a skip is unanswered, slashable by the owner", async () => {
    const ctx = await loadFixture(deploy);
    await expect(ctx.adapter.connect(ctx.other).postBond({ value: WAD })).to.be.revertedWith("KHC: not keeper");
    await ctx.adapter.connect(ctx.keeper).postBond({ value: WAD });
    expect(await ctx.adapter.bond()).to.equal(WAD);

    // manufacture a stale skip
    await ctx.consumer.request(1);
    await mine(270);
    await ctx.adapter.skipStale();

    await expect(ctx.adapter.connect(ctx.keeper).withdrawBond(WAD)).to.be.revertedWith("KHC: slashable skip");

    const slashAmt = WAD / 4n;
    const before = await ethers.provider.getBalance(ctx.buyer.address);
    await ctx.adapter.connect(ctx.owner).slash(ctx.buyer.address, slashAmt);
    expect(await ethers.provider.getBalance(ctx.buyer.address)).to.equal(before + slashAmt);
    expect(await ctx.adapter.bond()).to.equal(WAD - slashAmt);
    expect(await ctx.adapter.slashableSkips()).to.equal(0n);
    await expect(ctx.adapter.connect(ctx.owner).slash(ctx.buyer.address, 1n)).to.be.revertedWith(
      "KHC: nothing slashable"
    );

    // with the incident answered the keeper reclaims the rest
    await ctx.adapter.connect(ctx.keeper).withdrawBond(WAD - slashAmt);
    expect(await ctx.adapter.bond()).to.equal(0n);
  });

  it("keeper rotation requires a settled bond", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.adapter.connect(ctx.keeper).postBond({ value: WAD });
    await expect(ctx.adapter.connect(ctx.owner).setKeeper(ctx.other.address)).to.be.revertedWith(
      "KHC: bond posted"
    );
    await ctx.adapter.connect(ctx.keeper).withdrawBond(WAD);
    await ctx.adapter.connect(ctx.owner).setKeeper(ctx.other.address);
    expect(await ctx.adapter.keeper()).to.equal(ctx.other.address);
  });

  describe("with FWAPool end-to-end", function () {
    async function deployPool() {
      const ctx = await loadFixture(deploy);
      const { owner, keeper, buyer } = ctx;
      const [, , , , alice, treasury] = await ethers.getSigners();

      const backing = await (await ethers.getContractFactory("MockERC20")).deploy("MockUSDG", "USDG", 18);
      const nft = await (await ethers.getContractFactory("MockERC721")).deploy("Punks", "PUNK");
      const whitelist = await (await ethers.getContractFactory("FWAWhitelist")).deploy(owner.address);
      await whitelist.setAllowed(await nft.getAddress(), true);

      const pool = await (await ethers.getContractFactory("FWAPool")).deploy(
        await backing.getAddress(),
        await ctx.router.getAddress(),
        await whitelist.getAddress(),
        treasury.address,
        owner.address
      );
      await ctx.router.setConsumer(await pool.getAddress(), true);

      for (const s of [alice, buyer]) {
        await backing.mint(s.address, 1_000_000n * WAD);
        await backing.connect(s).approve(await pool.getAddress(), ethers.MaxUint256);
      }
      await nft.mint(alice.address, 1);
      await nft.connect(alice).approve(await pool.getAddress(), 1);
      await pool.connect(alice).deposit(await nft.getAddress(), 1, 100n * WAD);

      return { ...ctx, alice, treasury, backing, nft, pool };
    }

    it("a real draw settles on keeper randomness", async () => {
      const ctx = await deployPool();
      await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
      const drawId = await ctx.pool.drawCount();
      const reqId = await ctx.router.requestCounter();
      const seedBlock = await ctx.adapter.seedBlock();

      await mine(6);
      const preimage = ctx.links[CHAIN_LEN - 1];
      await ctx.adapter.connect(ctx.keeper).reveal(preimage);

      const d = await ctx.pool.draws(drawId);
      expect(d.state).to.equal(2n); // Fulfilled
      expect(d.randomWord).to.equal(await expectedWord(reqId, seedBlock, preimage));

      await ctx.pool.connect(ctx.buyer).settle(drawId, 0); // Keep
      expect(await ctx.nft.ownerOf(1)).to.equal(ctx.buyer.address);
      expect(await ctx.pool.drawInFlight()).to.equal(false);
    });

    it("keeper outage: pool refunds via expireDraw; a late reveal is harmless", async () => {
      const ctx = await deployPool();
      const price = await ctx.pool.acquisitionPrice();
      await ctx.pool.connect(ctx.buyer).startDraw(ethers.MaxUint256);
      const drawId = await ctx.pool.drawCount();

      await time.increase(3601);
      await ctx.pool.expireDraw(drawId);
      expect(await ctx.pool.backingCredit(ctx.buyer.address)).to.equal(price);

      // keeper comes back inside the blockhash window: the reveal succeeds,
      // the pool ignores the stale word, and the adapter is unblocked
      await mine(6);
      await expect(ctx.adapter.connect(ctx.keeper).reveal(ctx.links[CHAIN_LEN - 1])).to.emit(
        ctx.pool,
        "StaleFulfillment"
      );
      expect((await ctx.pool.draws(drawId)).state).to.equal(4n); // still Refunded
      expect(await ctx.adapter.pendingRequestId()).to.equal(0n);
    });
  });
});
