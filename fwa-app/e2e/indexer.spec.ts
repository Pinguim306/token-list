import { test, expect } from "@playwright/test";

/**
 * Runs against the build where a pool address IS configured (so demo mode is
 * off) and NEXT_PUBLIC_INDEXER_URL points at e2e/mock-indexer.mjs.
 *
 * This is the only place the GraphQL client is exercised end to end: query
 * shape, Ponder's `{ items, totalCount }` envelope, bigint parsing, nullable
 * fields, and the failure states.
 */

test("reads history from the indexer and labels the source", async ({ page }) => {
  await page.goto("/app/draws");

  await expect(page.getByText("Indexed")).toBeVisible();

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  // ids come back as strings and must survive BigInt parsing
  await expect(rows.first()).toContainText("#31");
});

test("parses nullable fields — a refunded draw has no position or latency", async ({ page }) => {
  await page.goto("/app/draws");

  const refunded = page.locator("tbody tr").filter({ hasText: "Refunded" });
  await expect(refunded).toHaveCount(1);
  // selectedId and resolvedAt arrive as null from the indexer
  await expect(refunded.locator('a[href^="/app/position/"]')).toHaveCount(0);
  await expect(refunded).toContainText("—");
});

test("computes latency from indexed timestamps", async ({ page }) => {
  await page.goto("/app/draws");
  // draw 31: requested 1784930000, resolved 1784930039 → 39s
  await expect(page.locator("tbody tr").first()).toContainText("39s");
});

test("reports the true total, not just the page size", async ({ page }) => {
  await page.goto("/app/draws");
  // mock reports totalCount 87 while returning 3 rows
  await expect(page.getByText(/most recent of 87 draws/)).toBeVisible();
});

test("surfaces a GraphQL error instead of an empty table", async ({ page }) => {
  // force the indexer to answer with a GraphQL-level error
  await page.route("**/graphql", (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("fail", "1");
    route.continue({ url: url.toString() });
  });

  await page.goto("/app/draws");

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Could not reach the indexer")).toBeVisible();
  await expect(page.getByText("indexer is resyncing")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("surfaces a transport failure the same way", async ({ page }) => {
  await page.route("**/graphql", (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("http", "1");
    route.continue({ url: url.toString() });
  });

  await page.goto("/app/draws");

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText(/HTTP 500/)).toBeVisible();
});
