import { test, expect } from "@playwright/test";

/**
 * Equity basket wrap/unwrap surfaces in demo mode. Same crash-resilience bar
 * as the other write surfaces: free-text input must produce field errors, not
 * unmount the page.
 */

test.describe("baskets page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app/baskets");
  });

  test("renders the wrap form and the sample baskets", async ({ page }) => {
    await expect(page.locator("[data-basket-wrap]")).toBeVisible();
    // two demo baskets with their contents listed
    await expect(page.locator("[data-basket-item]")).toHaveCount(2);
    await expect(page.locator('[data-basket-item="1"]')).toContainText("TSLAon");
    await expect(page.locator('[data-basket-item="1"]')).toContainText("SPCX");
    await expect(page.locator('[data-basket-item="2"]')).toContainText("NVDAon");
  });

  test("garbage input shows field errors and the page survives", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    await page.fill("#wrap-token-0", "not-an-address");
    await page.fill("#wrap-amount-0", "abc");

    await expect(page.getByText(/must be a 0x… address/)).toBeVisible();
    await expect(page.getByText(/Amount must be a number/)).toBeVisible();
    // the wrap button must be unsubmittable with invalid fields
    await expect(page.locator("[data-wrap-submit]")).toBeDisabled();
    // and the rest of the page is still alive
    await expect(page.locator("[data-basket-item]")).toHaveCount(2);
    expect(crashes).toEqual([]);
  });

  test("recognizes a demo equity token and flags duplicates", async ({ page }) => {
    const TSLAon = "0x417883b1709545f1211A25b00ad13455fC7F1bc5";
    await page.fill("#wrap-token-0", TSLAon);
    await expect(page.locator("[data-token-symbol]")).toHaveText("TSLAon");

    await page.locator("[data-add-leg]").click();
    await expect(page.locator("[data-wrap-row]")).toHaveCount(2);
    await page.fill("#wrap-token-1", TSLAon.toLowerCase());
    await expect(page.getByText(/appears twice/)).toBeVisible();

    // removing the duplicate row clears the error
    await page.getByRole("button", { name: "Remove token 2" }).click();
    await expect(page.locator("[data-wrap-row]")).toHaveCount(1);
    await expect(page.getByText(/appears twice/)).toHaveCount(0);
  });

  test("row count is capped at the contract's 16-leg maximum", async ({ page }) => {
    const add = page.locator("[data-add-leg]");
    for (let i = 1; i < 16; i++) await add.click();
    await expect(page.locator("[data-wrap-row]")).toHaveCount(16);
    await expect(add).toBeDisabled();
  });

  test("baskets are valued in USD from the configured prices", async ({ page }) => {
    // demo prices are round on purpose: 2 TSLAon@300 + 4 SPCX@100, 5 NVDAon@100
    await expect(page.locator('[data-basket-item="1"] [data-basket-value]')).toHaveText("≈ $1,000.00");
    await expect(page.locator('[data-basket-item="2"] [data-basket-value]')).toHaveText("≈ $500.00");
    await expect(page.locator('[data-basket-item="1"]')).toContainText("$600.00");
    await expect(page.locator('[data-basket-item="1"]')).toContainText("$400.00");
  });

  test("the wrap form totals the contents' USD value", async ({ page }) => {
    await page.fill("#wrap-token-0", "0x417883b1709545f1211A25b00ad13455fC7F1bc5");
    await page.fill("#wrap-amount-0", "10");
    await expect(page.locator("[data-wrap-value]")).toContainText("≈ $3,000.00");
  });

  test("the app nav reaches baskets", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("link", { name: "Build packs" }).click();
    await expect(page).toHaveURL(/\/app\/baskets/);
    await expect(page.locator("[data-basket-wrap]")).toBeVisible();
  });
});
