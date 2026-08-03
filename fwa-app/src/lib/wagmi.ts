import { http, createConfig } from "wagmi";
import { bsc, bscTestnet } from "./chains";

// EIP-6963 multi-injected-provider discovery is enabled by default, so we do NOT
// statically import a connector from "wagmi/connectors" — that barrel pulls in the
// Coinbase Base Account connector and its heavy optional x402 payment deps. Injected
// wallets (MetaMask, Rabby, Binance Wallet, …) are discovered at runtime.
export const config = createConfig({
  chains: [bscTestnet, bsc],
  transports: {
    [bscTestnet.id]: http(),
    [bsc.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
