import { defineChain } from "viem";

/**
 * HyperEVM — the protocol's home.
 *
 * viem does not ship these chains: HyperEVM's chain id (999) collided with an
 * existing registry entry, so upstream PRs sit behind `ethereum-lists/chains`.
 * We define them here instead — this file stays the single source of chain
 * truth, and every screen reads `activeChain` for the explorer and the network
 * switch.
 *
 * Mainnet (999) is the default so the demo checkout transacts on real HyperEVM;
 * set NEXT_PUBLIC_CHAIN=testnet for chain 998.
 */
export const hyperEvm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "Hyperliquid", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.hyperliquid.xyz/evm"] },
  },
  blockExplorers: {
    default: { name: "HyperEVMScan", url: "https://hyperevmscan.io" },
  },
});

export const hyperEvmTestnet = defineChain({
  id: 998,
  name: "HyperEVM Testnet",
  nativeCurrency: { name: "Hyperliquid", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.hyperliquid-testnet.xyz/evm"] },
  },
  blockExplorers: {
    default: { name: "Purrsec", url: "https://testnet.purrsec.com" },
  },
  testnet: true,
});

export const activeChain = process.env.NEXT_PUBLIC_CHAIN === "testnet" ? hyperEvmTestnet : hyperEvm;
