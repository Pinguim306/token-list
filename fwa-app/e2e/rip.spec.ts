import { test, expect } from "@playwright/test";

/**
 * The sealed-pack draw reveal on the pool page. In demo mode the pack is
 * clickable and runs a scripted rip timeline ending on the revealed position
 * (demo draw selects position #4 = TSLAB #999).
 */

test.describe("sealed-pack rip reveal", () => {
  test("the pack rips open and reveals the drawn position", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    await page.goto("/app");
    const stage = page.locator("[data-rip-stage]");
    await expect(stage).toHaveAttribute("data-rip-phase", "idle");
    await expect(stage).toContainText(/Tap the pack/i);

    await stage.click();
    // scripted timeline: sealed -> locking -> tearing -> revealed (~3s)
    await expect(stage).toHaveAttribute("data-rip-phase", "revealed");
    await expect(stage.locator('[data-nft-art="TSLAB-999"]')).toBeVisible();
    await expect(stage).toContainText(/Position #4 revealed/);
    expect(crashes).toEqual([]);
  });

  test("the keeper status copy shows while the pack is sealed", async ({ page }) => {
    await page.goto("/app");
    const stage = page.locator("[data-rip-stage]");
    await stage.click();
    await expect(stage).toContainText(/keeper answers on its own clock/i);
  });
});

/**
 * The hardcoded demo checkout: buying a pack is a REAL native-BNB transfer to
 * the treasury (draw + settlement simulated). Without a wallet the buy button
 * must be visibly priced but unclickable — a visitor can never fire a
 * transaction by accident, and Playwright has no wallet, so this is also what
 * keeps the rest of the suite side-effect-free.
 */
test.describe("demo checkout", () => {
  test("the buy button shows the BNB price and requires a wallet", async ({ page }) => {
    await page.goto("/app");
    const buy = page.locator("[data-buy-pack]");
    await expect(buy).toContainText("0.01325 BNB");
    await expect(buy).toBeDisabled();
    await expect(buy).toHaveAttribute("title", /Connect your wallet/);
  });

  test("quantity multiplies the price — up to 20 packs per transaction", async ({ page }) => {
    await page.goto("/app");
    const buy = page.locator("[data-buy-pack]");
    const qty = page.locator("[data-qty]");

    // stepper: 1 → 2 packs doubles the exact BNB total
    await page.locator("[data-qty-plus]").click();
    await expect(qty).toHaveValue("2");
    await expect(buy).toContainText("Rip 2 packs · 0.0265 BNB");

    // typing 20 hits the cap; the + button closes
    await qty.fill("20");
    await expect(buy).toContainText("Rip 20 packs · 0.265 BNB");
    await expect(page.locator("[data-qty-plus]")).toBeDisabled();

    // over the cap clamps back to 20; garbage clamps to 1
    await qty.fill("25");
    await expect(qty).toHaveValue("20");
    await qty.fill("0");
    await expect(qty).toHaveValue("1");
    await expect(buy).toContainText("Rip a pack · 0.01325 BNB");
    await expect(page.locator("[data-qty-minus]")).toBeDisabled();
  });
});
