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
// against them once the deploy block ages out (there is no official /nanoreth
// path on rpc.hyperliquid.xyz — it 404s). Point PONDER_RPC_URL at an archival
// endpoint: a provider such as QuickNode, Chainstack (whose endpoints expose a
// /nanoreth archive path), or a self-hosted nanoreth archive node.
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 998);
const RPC =
  process.env.PONDER_RPC_URL ??
  (CHAIN_ID === 999 ? "https://rpc.hyperliquid.xyz/evm" : "https://rpc.hyperliquid-testnet.xyz/evm");
const START = Number(process.env.START_BLOCK ?? 0);

// The public HyperEVM RPCs cannot serve block 0 (pruned) — Ponder's sync setup
// fetches the start block and dies on "invalid block height" after a long
// retry loop. When a real deployment is configured (any non-zero address),
// fail fast with an actionable message instead. The all-zero quick-start/CI
// case is left alone so `npm run codegen` works with default env.
const anyConfigured = [
  process.env.POOL_ADDRESS,
  process.env.EMITTER_ADDRESS,
  process.env.BASKET_ADDRESS,
  process.env.ADAPTER_ADDRESS,
].some((a) => a && a !== ZERO);
if (anyConfigured && START === 0 && /rpc\.hyperliquid(-testnet)?\.xyz/.test(RPC)) {
  throw new Error(
    "START_BLOCK is unset (0), but contract addresses are configured and the " +
      "RPC is a pruned public HyperEVM endpoint that cannot serve genesis. " +
      "Set START_BLOCK to the deploy block (see the explorer), or point " +
      "PONDER_RPC_URL at an archival endpoint.",
  );
}
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
