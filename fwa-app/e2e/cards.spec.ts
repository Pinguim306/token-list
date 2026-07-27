import { test, expect } from "@playwright/test";

/**
 * The fwa.fun-style card effects on the landing page: orbit carousel with
 * pointer drag + spring snap, CSS 3D flip, pointer-tracking tilt and holo.
 * All DOM + CSS — these tests also guard the pointer-capture subtlety:
 * capturing on pointerdown would retarget clicks away from the flip button.
 */

test.describe("orbit carousel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#cards");
    await page.locator("[data-carousel-orbit]").scrollIntoViewIfNeeded();
  });

  test("renders every demo position as a card", async ({ page }) => {
    await expect(page.locator("[data-carousel-card]")).toHaveCount(5);
    await expect(page.locator("[data-carousel-orbit]")).toHaveAttribute("data-active", "0");
  });

  test("clicking the active card flips it, and the page survives", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    const flip = page.locator('[data-logical-index="0"] .pcard-flip');
    await flip.click();
    await expect(flip).toHaveAttribute("data-flipped", "true");

    // flip back
    await flip.click();
    await expect(flip).toHaveAttribute("data-flipped", "false");
    expect(crashes).toEqual([]);
  });

  test("dragging advances to another card and snaps to an integer index", async ({ page }) => {
    const track = page.locator(".orbit-track");
    const box = (await track.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 340, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator("[data-carousel-orbit]")).toHaveAttribute("data-active", "2");
  });

  test("a drag that ends on a card does not flip it", async ({ page }) => {
    const track = page.locator(".orbit-track");
    const box = (await track.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 170, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    // no card may be flipped after a drag release
    await expect(page.locator('.pcard-flip[data-flipped="true"]')).toHaveCount(0);
  });

  test("arrow keys move the carousel", async ({ page }) => {
    const orbit = page.locator("[data-carousel-orbit]");
    await orbit.focus();
    await page.keyboard.press("ArrowRight");
    await expect(orbit).toHaveAttribute("data-active", "1");
    await page.keyboard.press("ArrowLeft");
    await expect(orbit).toHaveAttribute("data-active", "0");
  });

  test("pointer movement over the active card drives tilt and holo position", async ({ page }) => {
    const tilt = page.locator('[data-logical-index="0"] .pcard-tilt');
    const box = (await tilt.boundingBox())!;

    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25);
    // the spring loop needs a few frames to write the transform
    await expect
      .poll(async () => tilt.evaluate((el) => (el as HTMLElement).style.transform))
      .toContain("rotateY");
    const holoX = await tilt.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--holo-x"));
    expect(parseFloat(holoX)).toBeGreaterThan(50);
  });
});
