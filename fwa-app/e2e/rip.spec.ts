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
