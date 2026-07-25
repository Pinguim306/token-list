import { execFileSync } from "node:child_process";

/**
 * Builds both app variants before Playwright runs.
 *
 * This is a pre-step of the `e2e` npm script rather than Playwright's
 * globalSetup, because Playwright starts `webServer` entries BEFORE globalSetup
 * — the servers would have nothing to serve.
 *
 * They must be sequential: `next build` writes shared files in the project root
 * (next-env.d.ts, tsconfig edits, the type cache), so two concurrent builds in
 * the same directory race and one silently wins — which showed up as the
 * "indexer" server serving a demo-mode bundle.
 *
 * NEXT_PUBLIC_* is inlined at build time, so each variant needs its own distDir;
 * the web servers then only run `next start` against the right one.
 */
const VARIANTS = [
  {
    name: "demo",
    env: {
      NEXT_PUBLIC_POOL_ADDRESS: "0x0000000000000000000000000000000000000000",
      NEXT_PUBLIC_INDEXER_URL: "",
      NEXT_DIST_DIR: ".next-e2e-demo",
    },
  },
  {
    name: "indexer",
    env: {
      NEXT_PUBLIC_POOL_ADDRESS: "0x00000000000000000000000000000000000000a1",
      NEXT_PUBLIC_BACKING_TOKEN: "0x00000000000000000000000000000000000000b1",
      NEXT_PUBLIC_INDEXER_URL: `http://127.0.0.1:${process.env.MOCK_INDEXER_PORT ?? 4510}`,
      NEXT_DIST_DIR: ".next-e2e-indexer",
    },
  },
];

function buildAll() {
  for (const v of VARIANTS) {
    process.stdout.write(`\n[e2e] building "${v.name}" → ${v.env.NEXT_DIST_DIR}\n`);
    execFileSync("npx", ["next", "build"], {
      stdio: "inherit",
      env: { ...process.env, ...v.env },
    });
  }
}

buildAll();
