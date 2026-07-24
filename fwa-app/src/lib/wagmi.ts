import { http, createConfig } from "wagmi";
import { robinhoodTestnet, robinhoodMainnet } from "./chains";

// EIP-6963 multi-injected-provider discovery is enabled by default, so we do NOT
// statically import a connector from "wagmi/connectors" — that barrel pulls in the
// Coinbase Base Account connector and its heavy optional x402 payment deps. Injected
// wallets (MetaMask, Rabby, Robinhood Wallet, …) are discovered at runtime.
export const config = createConfig({
  chains: [robinhoodTestnet, robinhoodMainnet],
  transports: {
    [robinhoodTestnet.id]: http(),
    [robinhoodMainnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
