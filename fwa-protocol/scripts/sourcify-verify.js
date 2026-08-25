/**
 * Verify deployed contracts on Sourcify via its v2 API.
 *
 *   node scripts/sourcify-verify.js <chainId> <address>=<fqn> [<address>=<fqn> ...]
 *
 *   node scripts/sourcify-verify.js 999 \
 *     0x3B5a...3Ab=contracts/core/FWAPool.sol:FWAPool \
 *     0x479F...720=contracts/randomness/RandomnessRouter.sol:RandomnessRouter
 *
 * Why this exists: Sourcify sunset its v1 API (`POST /verify`,
 * `GET /check-all-by-addresses`), and hardhat-verify 2.x still posts to those
 * removed endpoints — `npx hardhat verify` with Sourcify enabled fails with an
 * HTML "Cannot POST /verify" error. This script talks to the current v2 API
 * (`POST /v2/verify/{chainId}/{address}`) directly, reusing the standard-JSON
 * compiler input Hardhat already stores under artifacts/build-info, so a plain
 * `npx hardhat compile` is the only prerequisite. Constructor arguments are
 * not needed: Sourcify v2 extracts them from the creation transaction.
 *
 * Sourcify supports both HyperEVM chains (999 and 998) — for testnet this is
 * the only verification route (Etherscan V2 does not cover 998).
 */
const fs = require("fs");
const path = require("path");

const API = process.env.SOURCIFY_API || "https://sourcify.dev/server";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [chainId, ...pairs] = process.argv.slice(2);
  if (!chainId || pairs.length === 0) {
    console.error("usage: node scripts/sourcify-verify.js <chainId> <address>=<fqn> [...]");
    process.exit(1);
  }

  const buildInfoDir = path.join(__dirname, "..", "artifacts", "build-info");
  if (!fs.existsSync(buildInfoDir)) {
    console.error("no artifacts/build-info — run `npx hardhat compile` first");
    process.exit(1);
  }
  const buildInfos = fs.readdirSync(buildInfoDir).map((f) =>
    JSON.parse(fs.readFileSync(path.join(buildInfoDir, f)))
  );

  const pending = [];
  let failed = false;
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const address = pair.slice(0, eq);
    const fqn = pair.slice(eq + 1);
    const sourceName = fqn.split(":")[0];
    const info = buildInfos.find((b) => b.input.sources[sourceName]);
    if (!info) {
      console.error(`${address}: no build-info contains ${sourceName} — recompile?`);
      failed = true;
      continue;
    }
    const res = await fetch(`${API}/v2/verify/${chainId}/${address}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stdJsonInput: info.input,
        compilerVersion: info.solcLongVersion,
        contractIdentifier: fqn,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 202) {
      console.log(`${fqn} @ ${address}: submitted`);
      pending.push({ address, fqn, id: j.verificationId });
    } else if (res.status === 409) {
      console.log(`${fqn} @ ${address}: already verified`);
    } else {
      console.error(`${fqn} @ ${address}: HTTP ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
      failed = true;
    }
    await sleep(300);
  }

  for (const p of pending) {
    let done = false;
    for (let i = 0; i < 60 && !done; i++) {
      const j = await (await fetch(`${API}/v2/verify/${p.id}`)).json();
      if (j.isJobCompleted) {
        done = true;
        const match = j.contract && j.contract.match;
        if (match) {
          console.log(`${p.fqn} @ ${p.address}: ${match}`);
        } else {
          console.error(`${p.fqn} @ ${p.address}: FAILED ${JSON.stringify(j.error || j).slice(0, 200)}`);
          failed = true;
        }
      } else {
        await sleep(2000);
      }
    }
    if (!done) {
      console.error(`${p.fqn} @ ${p.address}: verification job timed out (check ${API}/v2/verify/${p.id})`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
