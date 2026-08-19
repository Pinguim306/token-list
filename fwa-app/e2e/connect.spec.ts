import { test, expect } from "@playwright/test";

/**
 * The wallet picker. Wallets are discovered via EIP-6963 — each extension
 * announces itself — and the Connect button must open a chooser rather than
 * silently taking whichever wallet announced first (the bug this guards:
 * with MetaMask and Rabby both installed, only Rabby would ever open).
 *
 * Playwright ships no wallet extensions, so the multi-wallet scenario injects
 * two minimal EIP-6963 providers before the app loads.
 */

const ADDRESS = "0x1111111111111111111111111111111111111111";

/** Announce two fake wallets (MetaMask + Rabby) the EIP-6963 way. Each mock
 *  behaves like a real, not-yet-authorized wallet: eth_accounts is empty until
 *  eth_requestAccounts runs — otherwise wagmi's reconnect-on-mount sees an
 *  authorized wallet and silently connects it before the picker ever opens. */
const INJECT_TWO_WALLETS = `
(() => {
  const makeProvider = () => {
    let authorized = false;
    const provider = {
      request: async ({ method }) => {
        switch (method) {
          case "eth_requestAccounts":
            authorized = true;
            return ["${ADDRESS}"];
          case "eth_accounts":
            return authorized ? ["${ADDRESS}"] : [];
          case "eth_chainId":
            return "0x38"; // BSC mainnet — the demo build's active chain
          default:
            return null;
        }
      },
      on: () => {},
      removeListener: () => {},
    };
    return provider;
  };
  const ICON =
    "data:image/svg+xml," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="grey"/></svg>');
  const wallets = [
    { info: { uuid: "355a3580-0000-4000-8000-000000000001", name: "Rabby Wallet", icon: ICON, rdns: "io.rabby" }, provider: makeProvider() },
    { info: { uuid: "355a3580-0000-4000-8000-000000000002", name: "MetaMask", icon: ICON, rdns: "io.metamask" }, provider: makeProvider() },
  ];
  const announce = () => {
    for (const detail of wallets) {
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze(detail) }));
    }
  };
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
`;

test.describe("wallet picker", () => {
  test("without a wallet, the picker explains and offers installs", async ({ page }) => {
    await page.goto("/app");
    await page.locator("[data-connect-wallet]").click();
    const picker = page.locator("[data-wallet-picker]");
    await expect(picker).toBeVisible();
    await expect(picker.locator("[data-wallet-empty]")).toContainText("No wallet detected");
    await expect(picker.getByRole("link", { name: "MetaMask" })).toHaveAttribute("href", "https://metamask.io");
    await expect(picker.getByRole("link", { name: "Rabby" })).toHaveAttribute("href", "https://rabby.io");
    // Escape closes it
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
  });

  test("lists every announced wallet, MetaMask and Rabby first", async ({ page }) => {
    await page.addInitScript(INJECT_TWO_WALLETS);
    await page.goto("/app");
    await page.locator("[data-connect-wallet]").click();
    const options = page.locator("[data-wallet-option]");
    await expect(options).toHaveCount(2);
    // Rabby announced first, but the preferred order still puts MetaMask on top
    await expect(options.nth(0)).toContainText("MetaMask");
    await expect(options.nth(1)).toContainText("Rabby Wallet");
  });

  test("choosing a specific wallet connects it — not whichever announced first", async ({ page }) => {
    await page.addInitScript(INJECT_TWO_WALLETS);
    await page.goto("/app");
    await page.locator("[data-connect-wallet]").click();
    await page.locator('[data-wallet-option="io.metamask"]').click();
    // connected: the picker is gone and the header shows the short address
    await expect(page.locator("[data-wallet-picker]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /0x1111…1111/ })).toBeVisible();
  });

  test("overlay click closes the picker without connecting", async ({ page }) => {
    await page.addInitScript(INJECT_TWO_WALLETS);
    await page.goto("/app");
    await page.locator("[data-connect-wallet]").click();
    await page.locator("[data-wallet-picker]").click({ position: { x: 5, y: 5 } });
    await expect(page.locator("[data-wallet-picker]")).toHaveCount(0);
    await expect(page.locator("[data-connect-wallet]")).toBeVisible();
  });
});
