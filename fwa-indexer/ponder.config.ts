import { createConfig } from "ponder";
import { http } from "viem";
import { FWAPoolAbi } from "./abis/FWAPoolAbi";
import { FWAEmitterAbi } from "./abis/FWAEmitterAbi";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const RPC = process.env.PONDER_RPC_URL_46630 ?? "https://rpc.testnet.chain.robinhood.com";
const START = Number(process.env.START_BLOCK ?? 0);

export default createConfig({
  networks: {
    robinhoodTestnet: { chainId: 46630, transport: http(RPC) },
  },
  contracts: {
    FWAPool: {
      network: "robinhoodTestnet",
      abi: FWAPoolAbi,
      address: (process.env.POOL_ADDRESS ?? ZERO) as `0x${string}`,
      startBlock: START,
    },
    FWAEmitter: {
      network: "robinhoodTestnet",
      abi: FWAEmitterAbi,
      address: (process.env.EMITTER_ADDRESS ?? ZERO) as `0x${string}`,
      startBlock: START,
    },
  },
});
