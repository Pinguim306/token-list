import { createConfig } from "ponder";
import { http } from "viem";
import { FWAPoolAbi } from "./abis/FWAPoolAbi";
import { FWAEmitterAbi } from "./abis/FWAEmitterAbi";
import { EquityBasketAbi } from "./abis/EquityBasketAbi";
import { KeeperHashChainAdapterAbi } from "./abis/KeeperHashChainAdapterAbi";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const RPC = process.env.PONDER_RPC_URL_46630 ?? "https://rpc.testnet.chain.robinhood.com";
const START = Number(process.env.START_BLOCK ?? 0);
const addr = (v: string | undefined) => (v ?? ZERO) as `0x${string}`;

// Optional contracts: when their address is left at the zero default Ponder
// simply finds no logs, so an incomplete deployment never breaks indexing.
export default createConfig({
  networks: {
    robinhoodTestnet: { chainId: 46630, transport: http(RPC) },
  },
  contracts: {
    FWAPool: {
      network: "robinhoodTestnet",
      abi: FWAPoolAbi,
      address: addr(process.env.POOL_ADDRESS),
      startBlock: START,
    },
    FWAEmitter: {
      network: "robinhoodTestnet",
      abi: FWAEmitterAbi,
      address: addr(process.env.EMITTER_ADDRESS),
      startBlock: START,
    },
    EquityBasket: {
      network: "robinhoodTestnet",
      abi: EquityBasketAbi,
      address: addr(process.env.BASKET_ADDRESS),
      startBlock: START,
    },
    KeeperHashChainAdapter: {
      network: "robinhoodTestnet",
      abi: KeeperHashChainAdapterAbi,
      address: addr(process.env.ADAPTER_ADDRESS),
      startBlock: START,
    },
  },
});
