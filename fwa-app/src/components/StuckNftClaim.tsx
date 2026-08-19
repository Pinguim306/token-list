"use client";

import { useState } from "react";
import { keccak256, encodePacked } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { pool } from "@/lib/contracts";
import { parseAddress, parseInteger } from "@/lib/parse";
import { short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import { NftArt } from "@/components/nft/NftArt";

/**
 * Recovery surface for NFTs the pool escrowed because settlement delivery
 * reverted (a paused/blocklisted collection). The pool records the rightful
 * recipient in `nftClaims[keccak256(asset, tokenId)]`; `claimStuckNFT`
 * releases it once transfers work again. Discovery is by probe (asset +
 * tokenId) — the same key derivation the contract uses, computed client-side.
 */
export function StuckNftClaim() {
  const { address, isConnected } = useAccount();
  const [asset, setAsset] = useState("");
  const [tokenId, setTokenId] = useState("");
  const pAsset = parseAddress(asset, "Collection address");
  const pId = parseInteger(tokenId, "Token id");

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({ hash });
  const busy = isPending || mining || DEMO;

  const key =
    pAsset.value && pId.value !== null
      ? keccak256(encodePacked(["address", "uint256"], [pAsset.value, pId.value]))
      : undefined;

  const { data: claimant } = useReadContract({
    ...pool,
    functionName: "nftClaims",
    args: key ? [key] : undefined,
    query: { enabled: !DEMO && !!key },
  });
  const mine =
    !!claimant &&
    !!address &&
    (claimant as string).toLowerCase() === address.toLowerCase();

  const claim = (a: `0x${string}`, id: bigint) => {
    reset();
    writeContract({ ...pool, functionName: "claimStuckNFT", args: [a, id] });
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm" data-stuck-nfts>
      <div className="border-b border-border px-6 py-4">
        <h2 className="m-0 font-display text-base text-ink">Escrowed NFTs</h2>
        <p className="m-0 mt-0.5 font-body text-xs text-muted">
          If a settlement transfer failed (paused collection), the pool escrowed your NFT — recover it
          here once the collection transfers again.
        </p>
      </div>
      <div className="px-6 py-5">
        {DEMO ? (
          <ul className="m-0 list-none space-y-3 p-0">
            {demo.stuckNfts.map((n) => (
              <li
                key={`${n.asset}-${n.tokenId}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-4 py-3"
                data-stuck-nft={`${n.symbol}-${n.tokenId}`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 overflow-hidden rounded-md border border-border">
                    <NftArt symbol={n.symbol} tokenId={n.tokenId.toString()} className="block h-full w-full" />
                  </div>
                  <div>
                    <p className="m-0 font-body text-sm text-ink">
                      {n.symbol} #{n.tokenId.toString()}
                    </p>
                    <p className="m-0 mt-0.5 font-mono text-xs text-muted">{short(n.asset)}</p>
                  </div>
                </div>
                <button className="btn primary" disabled >
                  Claim
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <input
                className="mono"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                placeholder="Collection 0x…"
                style={{ maxWidth: 300 }}
                aria-label="Collection address"
                aria-invalid={pAsset.error ? true : undefined}
              />
              <input
                inputMode="numeric"
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
                placeholder="Token id"
                style={{ maxWidth: 120 }}
                aria-label="Token id"
                aria-invalid={pId.error ? true : undefined}
              />
              <button
                className="btn primary"
                disabled={busy || !mine}
                title={
                  !isConnected
                    ? "Connect a wallet first"
                    : key && claimant && !mine
                      ? `Escrowed for ${short(claimant as string)}, not you`
                      : undefined
                }
                onClick={() => claim(pAsset.value!, pId.value!)}
              >
                Claim
              </button>
            </div>
            {pAsset.error ? <p className="field-error" role="alert">{pAsset.error}</p> : null}
            {pId.error ? <p className="field-error" role="alert">{pId.error}</p> : null}
            {key && claimant !== undefined ? (
              <p className="mt-2 mb-0 font-body text-xs text-muted" role="status">
                {(claimant as string) === "0x0000000000000000000000000000000000000000"
                  ? "Nothing escrowed under that collection + id."
                  : mine
                    ? "Escrowed for you — claim away."
                    : `Escrowed for ${short(claimant as string)}.`}
              </p>
            ) : null}
          </>
        )}

        {error ? (
          <p className="field-error" role="alert">
            Claim failed: {(error as { shortMessage?: string }).shortMessage ?? error.message} — if the
            collection is still paused, the claim stays open; try again later.
          </p>
        ) : null}
        {mined ? <p className="notice ok" role="status">Recovered.</p> : null}
      </div>
    </section>
  );
}
