import { defineChain } from "viem";

/** RobinhoodChain testnet (Arbitrum Orbit). */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "RobinhoodChain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

/** RobinhoodChain mainnet. */
export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "RobinhoodChain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const activeChain =
  process.env.NEXT_PUBLIC_CHAIN === "mainnet" ? robinhoodMainnet : robinhoodTestnet;
