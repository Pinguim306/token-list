import { test, expect } from "@playwright/test";

/**
 * The write surface — the only screens that can cost a user money.
 *
 * These guard a real crash: the deposit form used to call `BigInt(tokenId)` and
 * `parseUnits(amount)` directly in the component body. Both throw on
 * unparseable input, and a throw during render unmounts the tree — typing a
 * single letter into the token-id field blanked the entire /app page.
 */

const CARD = ".card";

test.describe("deposit form input handling", () => {
  test("a non-numeric token id shows an error, not a blank page", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    await page.goto("/app");
    const cardsBefore = await page.locator(CARD).count();
    expect(cardsBefore).toBeGreaterThan(0);

    await page.locator("#dep-token").fill("abc");

    await expect(page.getByText("Token id must be a whole number.")).toBeVisible();
    // the page survived
    await expect(page.locator(CARD)).toHaveCount(cardsBefore);
    expect(crashes).toEqual([]);
  });

  test("a decimal token id is rejected — ids are whole numbers", async ({ page }) => {
    await page.goto("/app");
    await page.locator("#dep-token").fill("1.5");
    await expect(page.getByText("Token id must be a whole number.")).toBeVisible();
  });

  test("a malformed amount shows an error, not a blank page", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    await page.goto("/app");
    const cardsBefore = await page.locator(CARD).count();

    await page.locator("#dep-amount").fill("1.2.3");

    await expect(page.getByText("Backing amount must be a number.")).toBeVisible();
    await expect(page.locator(CARD)).toHaveCount(cardsBefore);
    expect(crashes).toEqual([]);
  });

  test("an amount with too many decimals is rejected before it reaches the chain", async ({
    page,
  }) => {
    await page.goto("/app");
    // 19 decimal places against an 18-decimal token
    await page.locator("#dep-amount").fill("1.0000000000000000001");
    await expect(page.getByText(/more than 18 decimal places/)).toBeVisible();
  });

  test("valid input clears the error and enables Deposit", async ({ page }) => {
    await page.goto("/app");
    const deposit = page.getByRole("button", { name: "Deposit", exact: true });

    await page.locator("#dep-token").fill("abc");
    await expect(deposit).toBeDisabled();

    await page.locator("#dep-token").fill("42");
    await page.locator("#dep-amount").fill("100");

    await expect(page.getByText("Token id must be a whole number.")).toHaveCount(0);
    await expect(deposit).toBeEnabled();
  });

  test("zero backing is rejected — it would divide by zero in the weight", async ({ page }) => {
    await page.goto("/app");
    await page.locator("#dep-amount").fill("0");
    await expect(page.getByText(/greater than zero/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Deposit", exact: true })).toBeDisabled();
  });
});

test.describe("deposit preview + backing health", () => {
  test("typing an amount reveals bid, odds and fee previews", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("[data-deposit-preview]")).toHaveCount(0);

    await page.locator("#dep-amount").fill("100");
    const preview = page.locator("[data-deposit-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Standing bid (85.00%)");
    await expect(preview).toContainText("85"); // 85% of 100
    await expect(preview).toContainText(/1 in \d+/);
    await expect(preview).toContainText("Est. earnings per draw");
  });

  test("the health meter flags all three backing zones", async ({ page }) => {
    await page.goto("/app");
    await page.locator("#dep-amount").fill("100");

    // bid 85 > value 50 -> the sell-back trap from the StockRip analysis
    await page.locator("#dep-value").fill("50");
    const meter = page.locator("[data-health-zone]");
    await expect(meter).toHaveAttribute("data-health-zone", "over");
    await expect(meter).toContainText(/Sell-back trap/);

    // value 100: bid 85 below it, backing at it -> healthy
    await page.locator("#dep-value").fill("100");
    await expect(meter).toHaveAttribute("data-health-zone", "balanced");
    await expect(meter).toContainText(/Healthy/);

    // value 120: backing 100 under it -> below-market exit
    await page.locator("#dep-value").fill("120");
    await expect(meter).toHaveAttribute("data-health-zone", "under");
    await expect(meter).toContainText(/Below-market exit/);
  });

  test("a malformed estimate shows a field error, not a crash", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    await page.goto("/app");
    await page.locator("#dep-amount").fill("100");
    await page.locator("#dep-value").fill("abc");

    await expect(page.getByText("Estimated value must be a number.")).toBeVisible();
    await expect(page.locator("[data-health-zone]")).toHaveCount(0);
    // advisory only: a bad estimate must not block the deposit itself
    await page.locator("#dep-token").fill("42");
    await expect(page.getByRole("button", { name: "Deposit", exact: true })).toBeEnabled();
    expect(crashes).toEqual([]);
  });
});

test.describe("other write panels survive bad input", () => {
  test("claim-earnings position id is validated", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    await page.goto("/app");
    const cardsBefore = await page.locator(CARD).count();

    await page.locator("#claim-position").fill("not-an-id");

    await expect(page.getByText("Position id must be a whole number.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim earnings" })).toBeDisabled();
    await expect(page.locator(CARD)).toHaveCount(cardsBefore);
    expect(crashes).toEqual([]);
  });

  test("day-pot input is validated", async ({ page }) => {
    await page.goto("/app");
    await page.locator("#claim-day").fill("xyz");
    await expect(page.getByText("Day must be a whole number.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim day pot" })).toBeDisabled();
  });
});
