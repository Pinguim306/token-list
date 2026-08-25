import { createConfig } from "ponder";
import { http } from "viem";
import { FWAPoolAbi } from "./abis/FWAPoolAbi";
import { FWAEmitterAbi } from "./abis/FWAEmitterAbi";
import { EquityBasketAbi } from "./abis/EquityBasketAbi";
import { KeeperHashChainAdapterAbi } from "./abis/KeeperHashChainAdapterAbi";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
// HyperEVM by default (testnet 998; set CHAIN_ID=999 for mainnet).
//
// IMPORTANT: the public `/evm` endpoints are NOT archival — Hyperliquid prunes
// older blocks roughly every 12 hours, so a backfill from START_BLOCK will fail
// against them once the deploy block ages out. Point PONDER_RPC_URL at an
// archival endpoint (the `/nanoreth` path, or a provider such as QuickNode)
// for any deployment you intend to index from genesis of the contracts.
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 998);
const RPC =
  process.env.PONDER_RPC_URL ??
  (CHAIN_ID === 999 ? "https://rpc.hyperliquid.xyz/evm" : "https://rpc.hyperliquid-testnet.xyz/evm");
const START = Number(process.env.START_BLOCK ?? 0);
const addr = (v: string | undefined) => (v ?? ZERO) as `0x${string}`;

// Optional contracts: when their address is left at the zero default Ponder
// simply finds no logs, so an incomplete deployment never breaks indexing.
export default createConfig({
  networks: {
    hyperevm: { chainId: CHAIN_ID, transport: http(RPC) },
  },
  contracts: {
    FWAPool: {
      network: "hyperevm",
      abi: FWAPoolAbi,
      address: addr(process.env.POOL_ADDRESS),
      startBlock: START,
    },
    FWAEmitter: {
      network: "hyperevm",
      abi: FWAEmitterAbi,
      address: addr(process.env.EMITTER_ADDRESS),
      startBlock: START,
    },
    EquityBasket: {
      network: "hyperevm",
      abi: EquityBasketAbi,
      address: addr(process.env.BASKET_ADDRESS),
      startBlock: START,
    },
    KeeperHashChainAdapter: {
      network: "hyperevm",
      abi: KeeperHashChainAdapterAbi,
      address: addr(process.env.ADAPTER_ADDRESS),
      startBlock: START,
    },
  },
});
