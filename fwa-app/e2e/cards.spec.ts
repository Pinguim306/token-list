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
    // starts on the middle of 5 cards so the fan is symmetric
    await expect(page.locator("[data-carousel-orbit]")).toHaveAttribute("data-active", "2");
  });

  test("clicking the active card flips it, and the page survives", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));

    const flip = page.locator('[data-logical-index="2"] .pcard-flip');
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

    // two card-widths of drag from the middle (2) lands on 4
    await expect(page.locator("[data-carousel-orbit]")).toHaveAttribute("data-active", "4");
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
    await expect(orbit).toHaveAttribute("data-active", "3");
    await page.keyboard.press("ArrowLeft");
    await expect(orbit).toHaveAttribute("data-active", "2");
  });

  test("pointer movement over the active card drives tilt and holo position", async ({ page }) => {
    const tilt = page.locator('[data-logical-index="2"] .pcard-tilt');
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

test.describe("generative NFT art", () => {
  test("every screen renders artwork for its tokens", async ({ page }) => {
    await page.goto("/#cards");
    await expect(page.locator("[data-nft-art]")).toHaveCount(5);

    await page.goto("/app");
    await expect(page.locator("table [data-nft-art]")).toHaveCount(150);

    await page.goto("/app/collection/0xC0113c7100000000000000000000000000000001");
    await expect(page.locator("[data-nft-art]")).toHaveCount(52);

    await page.goto("/app/position/3");
    await expect(page.locator("[data-nft-art]")).toHaveCount(1);
  });

  test("art is deterministic — the same token renders identically everywhere", async ({ page }) => {
    await page.goto("/#cards");
    const onLanding = await page.locator('[data-nft-art="TSLAon-4242"] rect').count();
    expect(onLanding).toBeGreaterThan(4); // an actual fingerprint field, not an empty grid
    // known stock collections carry their company mark on top of the field
    await expect(page.locator('[data-nft-art="TSLAon-4242"] [data-brand="TSLAon"]').first()).toBeAttached();

    await page.goto("/app/collection/0xC0113c7100000000000000000000000000000001");
    const onCollection = await page.locator('[data-nft-art="TSLAon-4242"] rect').count();
    expect(onCollection).toBe(onLanding);
  });

  test("each stock collection renders its own brand mark", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator('[data-brand="TSLAon"]').first()).toBeAttached();
    await expect(page.locator('[data-brand="NVDAon"]').first()).toBeAttached();
    await expect(page.locator('[data-brand="SPCX"]').first()).toBeAttached();
  });
});
