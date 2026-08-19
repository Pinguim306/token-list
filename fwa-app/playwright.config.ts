import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Two app builds run side by side because NEXT_PUBLIC_* is inlined at build time:
 *
 *  - :4500 "demo"    — no pool configured, so every screen renders sample data.
 *  - :4501 "indexer" — a pool address is set (so DEMO is off) and
 *                      NEXT_PUBLIC_INDEXER_URL points at the mock indexer,
 *                      exercising the GraphQL path and its failure states.
 *
 * The chromium binary is the one preinstalled in this environment; there is no
 * browser download step.
 */
/**
 * Use a preinstalled chromium when one is present (this dev container ships
 * one and blocks browser downloads); otherwise fall back to Playwright's own
 * managed browser, which is what CI installs. An unset path must mean "let
 * Playwright decide" — never an empty executablePath.
 */
const CHROMIUM_CANDIDATE =
  process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CHROMIUM = existsSync(CHROMIUM_CANDIDATE) ? CHROMIUM_CANDIDATE : undefined;

const MOCK_PORT = 4510;

export default defineConfig({
  testDir: "./e2e",
  // Bundles are built by e2e/build-variants.mjs before Playwright starts —
  // webServer entries launch before globalSetup would run, so it cannot go there.
  timeout: 60_000,
  fullyParallel: true,
  // Two `next start` servers on a small container: the dynamic routes are
  // server-rendered on demand, so an over-subscribed worker pool makes them
  // miss the default 5s expect timeout even though they render fine.
  workers: process.env.CI ? 1 : 2,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    launchOptions: { ...(CHROMIUM ? { executablePath: CHROMIUM } : {}), args: ["--no-proxy-server"] },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "demo",
      testMatch: /(demo|forms|cards|baskets|rip|connect)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4500" },
    },
    {
      name: "indexer",
      testMatch: /indexer\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4501" },
    },
  ],
  webServer: [
    {
      command: "node e2e/mock-indexer.mjs",
      port: MOCK_PORT,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_INDEXER_PORT: String(MOCK_PORT) },
    },
    // Serve only — the bundles already exist by the time these start.
    {
      command: "npx next start -p 4500",
      port: 4500,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { NEXT_DIST_DIR: ".next-e2e-demo" },
    },
    {
      command: "npx next start -p 4501",
      port: 4501,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { NEXT_DIST_DIR: ".next-e2e-indexer" },
    },
  ],
});
