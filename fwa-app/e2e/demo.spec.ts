import { test, expect } from "@playwright/test";

/**
 * Runs against the build with no pool configured, so every screen renders the
 * sample data in src/lib/demo.ts. Assertions therefore check real derived
 * values (85% standing bids, inverse odds, totals), not just that text exists.
 */

test.describe("marketing landing", () => {
  test("is the site root and sends visitors to the app", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Fake world");
    await expect(page.locator("header a", { hasText: "Launch App" })).toHaveAttribute("href", "/app");
  });

  test("the old /landing path is gone", async ({ page }) => {
    const res = await page.goto("/landing");
    expect(res?.status()).toBe(404);
  });
});

test.describe("pool", () => {
  test("lists every sample position and links to detail", async ({ page }) => {
    await page.goto("/app");
    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(5);
    await expect(rows.first().locator("a")).toHaveAttribute("href", "/app/position/1");
  });

  test("nav reaches the other screens", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator(".nav-link")).toHaveText([
      "Collections",
      "Draws",
      "Baskets",
      "Fairness",
      "Portfolio",
      "How it works",
    ]);
  });

  test("the how-it-works deep dive covers the backing rule and settlement", async ({ page }) => {
    await page.goto("/how-it-works");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How it works");
    // the three-zone backing rule, verbatim from the economics
    await expect(page.getByText("Sell-back trap")).toBeVisible();
    await expect(page.getByText("Below-market exit")).toBeVisible();
    await expect(page.getByText("value ≤ backing ≤ value ÷ 0.85")).toBeVisible();
    // settlement + randomness essentials
    await expect(page.getByText(/yours alone for 24 hours/i)).toBeVisible();
    await expect(page.getByText(/hash chain/)).toBeVisible();
  });

  test("the provably-fair page shows keeper state and the request feed", async ({ page }) => {
    await page.goto("/app/randomness");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provably fair");
    // live adapter state (demo): committed chain head + reveals remaining
    await expect(page.locator("[data-chain-head]")).toContainText(/0x[0-9a-f]{4,}…[0-9a-f]{4}/);
    await expect(page.getByText("Reveals remaining")).toBeVisible();
    // the request feed: 5 demo rows, one of them a stale skip
    const rows = page.locator("[data-randomness-feed] tbody tr");
    await expect(rows).toHaveCount(5);
    await expect(page.getByText("skipped")).toBeVisible();
    // the verify formula is present
    await expect(page.getByText(/word\s+= keccak256\(preimage/)).toBeVisible();
  });

  test("the settlement countdown shows the buyer's exclusive window", async ({ page }) => {
    await page.goto("/app");
    const dl = page.locator("[data-draw-deadline]");
    await expect(dl).toBeVisible();
    // demo anchors fulfillment 14 minutes ago on a 24h window -> "23h 4xm"
    await expect(dl).toContainText(/Buyer's call for 23h \d+m/);
    await expect(dl).toContainText(/anyone can finalize/);
    // gating mirrors the contract: finalize stays closed while the window is open
    await expect(page.getByRole("button", { name: "Finalize" })).toBeDisabled();
  });
});

test.describe("position detail", () => {
  test("derives the standing bid as 85% of backing and flags the crown", async ({ page }) => {
    await page.goto("/app/position/3");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Position #3");
    // demo position 3: backing 400 → bid 340, odds 4.00%, and it holds the crown
    await expect(page.getByTestId("stat-backing")).toHaveText("400");
    await expect(page.getByTestId("stat-standing-bid")).toHaveText("340");
    await expect(page.getByTestId("stat-draw-odds")).toHaveText("4.00%");
    await expect(page.getByTestId("stat-crown")).toHaveText("Held");
  });

  test("rejects a non-numeric id instead of crashing", async ({ page }) => {
    await page.goto("/app/position/abc");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Invalid position");
  });

  test("explains an id that does not exist", async ({ page }) => {
    await page.goto("/app/position/99");
    await expect(page.getByText(/No sample position with this id/)).toBeVisible();
  });
});

test.describe("collections", () => {
  test("groups positions by their ERC-721 contract", async ({ page }) => {
    await page.goto("/app/collection");
    await expect(page.locator('a[href^="/app/collection/0x"]')).toHaveCount(2);
    await expect(page.getByText("Fake Punks")).toBeVisible();
    await expect(page.getByText("Fake Apes")).toBeVisible();
  });

  test("a collection totals its own positions only", async ({ page }) => {
    await page.goto("/app/collection");
    await page.locator('a[href^="/app/collection/0x"]').first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fake Punks");
    // Fake Punks holds positions 1, 2 and 4 → 30 + 60 + 75 = 165 backing,
    // floor bid = 85% of the lightest (30) = 25.5
    await expect(page.getByTestId("stat-items-in-pool")).toHaveText("3");
    await expect(page.getByTestId("stat-total-backing")).toHaveText("165");
    await expect(page.getByTestId("stat-floor-bid")).toHaveText("25.5");
    await expect(page.locator('a[href^="/app/position/"]')).toHaveCount(3);
  });

  test("rejects a malformed address", async ({ page }) => {
    await page.goto("/app/collection/nope");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Invalid collection");
  });
});

test.describe("portfolio", () => {
  test("sums backing and derives sell-back exposure", async ({ page }) => {
    await page.goto("/app/portfolio");
    // sample wallet holds positions 1 and 4 → 30 + 60 = 90 backing, 85% = 76.5
    await expect(page.getByText("90", { exact: true })).toBeVisible();
    await expect(page.getByText("76.5", { exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/app/position/"]')).toHaveCount(2);
  });
});

test.describe("draw history", () => {
  test("shows sample draws and marks the data source", async ({ page }) => {
    await page.goto("/app/draws");
    await expect(page.locator("tbody tr")).toHaveCount(5);
    await expect(page.getByTitle(/No pool configured/)).toHaveText("Sample data");
  });

  test("a refunded draw has no selected position and no latency", async ({ page }) => {
    await page.goto("/app/draws");
    const refunded = page.locator("tbody tr").filter({ hasText: "Refunded" });
    await expect(refunded).toHaveCount(1);
    // no position link on that row — randomness never arrived, nothing was selected
    await expect(refunded.locator('a[href^="/app/position/"]')).toHaveCount(0);
  });
});
