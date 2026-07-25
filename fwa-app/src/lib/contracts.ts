import type { Address } from "viem";
import { activeChain } from "./chains";
import {
  FWAPoolAbi,
  FWAEmitterAbi,
  FWATokenAbi,
  Erc20Abi,
  Erc721Abi,
} from "./abis";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/**
 * Each NEXT_PUBLIC_* var must be read as a STATIC property access. Next only
 * inlines `process.env.NEXT_PUBLIC_FOO` written literally; a dynamic
 * `process.env[key]` lookup is left alone on the server, so the server bundle
 * falls back to the zero address while the client bundle has the real one —
 * the two then disagree and server-rendered markup shows preview data on a
 * configured deployment.
 */
const addr = (value: string | undefined): Address =>
  value && value !== "" ? (value as Address) : ZERO;

export const addresses = {
  pool: addr(process.env.NEXT_PUBLIC_POOL_ADDRESS),
  backingToken: addr(process.env.NEXT_PUBLIC_BACKING_TOKEN),
  nftCollection: addr(process.env.NEXT_PUBLIC_NFT_COLLECTION),
  fwaToken: addr(process.env.NEXT_PUBLIC_FWA_TOKEN),
  emitter: addr(process.env.NEXT_PUBLIC_EMITTER),
};

export const chainId = activeChain.id;
export const explorer = activeChain.blockExplorers?.default.url ?? "";

export const pool = { address: addresses.pool, abi: FWAPoolAbi } as const;
export const emitter = { address: addresses.emitter, abi: FWAEmitterAbi } as const;
export const fwa = { address: addresses.fwaToken, abi: FWATokenAbi } as const;
export const backing = { address: addresses.backingToken, abi: Erc20Abi } as const;
export const nft = { address: addresses.nftCollection, abi: Erc721Abi } as const;
