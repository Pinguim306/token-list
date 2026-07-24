import type { Address } from "viem";
import { activeChain } from "./chains";
import {
  FWAPoolAbi,
  FWAEmitterAbi,
  FWATokenAbi,
  Erc20Abi,
  Erc721Abi,
} from "./abis";

const env = (k: string): Address =>
  (process.env[k] as Address) ?? "0x0000000000000000000000000000000000000000";

export const addresses = {
  pool: env("NEXT_PUBLIC_POOL_ADDRESS"),
  backingToken: env("NEXT_PUBLIC_BACKING_TOKEN"),
  nftCollection: env("NEXT_PUBLIC_NFT_COLLECTION"),
  fwaToken: env("NEXT_PUBLIC_FWA_TOKEN"),
  emitter: env("NEXT_PUBLIC_EMITTER"),
};

export const chainId = activeChain.id;
export const explorer = activeChain.blockExplorers?.default.url ?? "";

export const pool = { address: addresses.pool, abi: FWAPoolAbi } as const;
export const emitter = { address: addresses.emitter, abi: FWAEmitterAbi } as const;
export const fwa = { address: addresses.fwaToken, abi: FWATokenAbi } as const;
export const backing = { address: addresses.backingToken, abi: Erc20Abi } as const;
export const nft = { address: addresses.nftCollection, abi: Erc721Abi } as const;
