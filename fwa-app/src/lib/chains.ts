import { bsc, bscTestnet } from "viem/chains";

/**
 * BNB Chain — the protocol's home. Mainnet (56) by default so the demo
 * checkout transacts on real BSC; set NEXT_PUBLIC_CHAIN=testnet for chain 97.
 * viem ships both chain configs, including public RPCs and BscScan explorers.
 */
export { bsc, bscTestnet };

export const activeChain = process.env.NEXT_PUBLIC_CHAIN === "testnet" ? bscTestnet : bsc;
