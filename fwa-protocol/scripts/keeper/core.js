/**
 * Keeper core — the pure, testable logic behind the FWA keeper bot.
 *
 * The KeeperHashChainAdapter needs an off-chain operator that (1) commits
 * hash-chain heads, (2) reveals the next preimage once a request's seed block
 * is history, (3) skips requests whose seed aged out of the blockhash window,
 * and (4) rotates in a fresh chain before the current one runs dry. All of
 * that decision-making lives here as a single idempotent `tick`, so tests can
 * drive it against an in-process network and the CLI wrapper stays a dumb loop.
 *
 * Chain derivation is deterministic from one master secret, so the bot needs
 * NO local state: seed(epoch) = keccak256(masterSecret ‖ epoch), where epoch =
 * how many heads have ever been committed (counted from HeadCommitted events).
 * links[0] = seed, links[i+1] = keccak256(links[i]), head = links[length].
 * On restart the bot re-derives the active chain and locates the current head
 * in it — losing the process loses nothing.
 */
const { ethers } = require("ethers");

/** Per-chain seed: keccak256(masterSecret ‖ epoch). */
function chainSeed(masterSecret, epoch) {
  return ethers.solidityPackedKeccak256(["bytes32", "uint256"], [masterSecret, epoch]);
}

/** links[0] = seed … links[length] = committed head. */
function buildLinks(seed, length) {
  const links = [seed];
  for (let i = 0; i < length; i++) links.push(ethers.keccak256(links[i]));
  return links;
}

/** Index of `head` in `links`, scanning from the top (the head only ever
 *  walks backward). -1 if this chain never contained it. */
function locateHead(links, head) {
  for (let k = links.length - 1; k >= 0; k--) {
    if (links[k] === head) return k;
  }
  return -1;
}

/**
 * One idempotent pass over the adapter's state. Returns {action, ...detail}:
 *   wait | reveal | skip-stale | commit | idle
 *
 * cfg: { masterSecret, chainLength, minReveals = 10, fromBlock = 0 }
 */
async function tick(adapter, cfg) {
  const { masterSecret, chainLength, minReveals = 10, fromBlock = 0 } = cfg;
  const provider = adapter.runner.provider;

  const [head, remaining, pendingId, seedBlock, window] = await Promise.all([
    adapter.chainHead(),
    adapter.revealsRemaining(),
    adapter.pendingRequestId(),
    adapter.seedBlock(),
    adapter.BLOCKHASH_WINDOW(),
  ]);
  const now = await provider.getBlockNumber();

  // Epoch = number of heads ever committed. Only the keeper can commit, so
  // counting HeadCommitted events is authoritative and needs no local state.
  const commits = await adapter.queryFilter(adapter.filters.HeadCommitted(), fromBlock);
  const epoch = commits.length;

  if (pendingId !== 0n) {
    const sb = Number(seedBlock);
    if (now <= sb) {
      return { action: "wait", requestId: pendingId, seedBlock: sb, now };
    }
    if (now > sb + Number(window)) {
      await (await adapter.skipStale()).wait();
      return { action: "skip-stale", requestId: pendingId };
    }
    // The active chain was committed with seed index epoch-1.
    if (epoch === 0) {
      throw new Error(
        "a request is pending but no HeadCommitted event is visible — FROM_BLOCK is past the commit block?"
      );
    }
    const links = buildLinks(chainSeed(masterSecret, epoch - 1), chainLength);
    const k = locateHead(links, head);
    if (k < 1) {
      throw new Error(
        "active chain head is not derivable from this master secret " +
          "(wrong KEEPER_MASTER_SECRET, CHAIN_LENGTH, or FROM_BLOCK?)"
      );
    }
    await (await adapter.reveal(links[k - 1])).wait();
    return { action: "reveal", requestId: pendingId, linkIndex: k - 1 };
  }

  // Nothing pending: (re)commit when the chain is absent, exhausted, or low.
  if (head === ethers.ZeroHash || remaining < BigInt(minReveals)) {
    const links = buildLinks(chainSeed(masterSecret, epoch), chainLength);
    await (await adapter.commitHead(links[chainLength], chainLength)).wait();
    return { action: "commit", epoch, head: links[chainLength], reveals: chainLength };
  }

  return { action: "idle", remaining };
}

module.exports = { chainSeed, buildLinks, locateHead, tick };
