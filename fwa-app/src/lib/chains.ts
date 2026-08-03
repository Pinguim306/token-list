import { bsc, bscTestnet } from "viem/chains";

/**
 * BNB Chain — the protocol's home. Testnet (97) by default; set
 * NEXT_PUBLIC_CHAIN=mainnet for BSC (56). viem ships both chain configs,
 * including public RPCs and BscScan explorers.
 */
export { bsc, bscTestnet };

export const activeChain = process.env.NEXT_PUBLIC_CHAIN === "mainnet" ? bsc : bscTestnet;
