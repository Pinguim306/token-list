import { http, createConfig } from "wagmi";
import { hyperEvm, hyperEvmTestnet } from "./chains";

// EIP-6963 multi-injected-provider discovery is enabled by default, so we do NOT
// statically import a connector from "wagmi/connectors" — that barrel pulls in the
// Coinbase Base Account connector and its heavy optional x402 payment deps. Injected
// wallets (MetaMask, Rabby, OKX, …) are discovered at runtime.
export const config = createConfig({
  chains: [hyperEvmTestnet, hyperEvm],
  transports: {
    [hyperEvmTestnet.id]: http(),
    [hyperEvm.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
