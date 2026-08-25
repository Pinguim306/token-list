/**
 * Deployed-bytecode size report against EIP-170 (24,576 bytes).
 *
 * RobinhoodChain (Arbitrum Nitro) allowed 96 KB, so the limit never bound.
 * HyperEVM is a standard EVM — anything over 24 KB simply cannot be deployed,
 * and deployment gas has to fit HyperEVM's 30M-gas big blocks. Run this before
 * every deploy.
 */
const fs = require("fs");
const path = require("path");

const LIMIT = 24_576;
const root = path.join(__dirname, "..", "artifacts", "contracts");

const rows = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".json") && !e.name.endsWith(".dbg.json")) {
      const a = JSON.parse(fs.readFileSync(p, "utf8"));
      const code = a.deployedBytecode;
      if (typeof code === "string" && code.length > 2) {
        rows.push({ name: a.contractName, size: (code.length - 2) / 2 });
      }
    }
  }
})(root);

rows.sort((a, b) => b.size - a.size);
let over = 0;
for (const r of rows.slice(0, 12)) {
  const pct = ((r.size / LIMIT) * 100).toFixed(0);
  const flag = r.size > LIMIT ? "  ✗ OVER EIP-170" : "";
  if (r.size > LIMIT) over++;
  console.log(`${String(r.size).padStart(6)} B  ${pct.padStart(3)}%  ${r.name}${flag}`);
}
console.log(`\n${rows.length} contracts · limit ${LIMIT} B · ${over} over`);
process.exit(over > 0 ? 1 : 0);
