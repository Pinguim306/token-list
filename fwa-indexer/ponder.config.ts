import { createConfig } from "ponder";
import { http } from "viem";
import { FWAPoolAbi } from "./abis/FWAPoolAbi";
import { FWAEmitterAbi } from "./abis/FWAEmitterAbi";
import { EquityBasketAbi } from "./abis/EquityBasketAbi";
import { KeeperHashChainAdapterAbi } from "./abis/KeeperHashChainAdapterAbi";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
// BNB Chain by default (testnet 97; set CHAIN_ID=56 + an RPC for mainnet).
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 97);
const RPC =
  process.env.PONDER_RPC_URL ??
  (CHAIN_ID === 56 ? "https://bsc-dataseed.bnbchain.org" : "https://bsc-testnet.bnbchain.org");
const START = Number(process.env.START_BLOCK ?? 0);
const addr = (v: string | undefined) => (v ?? ZERO) as `0x${string}`;

// Optional contracts: when their address is left at the zero default Ponder
// simply finds no logs, so an incomplete deployment never breaks indexing.
export default createConfig({
  networks: {
    bnb: { chainId: CHAIN_ID, transport: http(RPC) },
  },
  contracts: {
    FWAPool: {
      network: "bnb",
      abi: FWAPoolAbi,
      address: addr(process.env.POOL_ADDRESS),
      startBlock: START,
    },
    FWAEmitter: {
      network: "bnb",
      abi: FWAEmitterAbi,
      address: addr(process.env.EMITTER_ADDRESS),
      startBlock: START,
    },
    EquityBasket: {
      network: "bnb",
      abi: EquityBasketAbi,
      address: addr(process.env.BASKET_ADDRESS),
      startBlock: START,
    },
    KeeperHashChainAdapter: {
      network: "bnb",
      abi: KeeperHashChainAdapterAbi,
      address: addr(process.env.ADAPTER_ADDRESS),
      startBlock: START,
    },
  },
});
