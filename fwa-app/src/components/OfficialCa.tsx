"use client";

import { useEffect, useRef, useState } from "react";
import { activeChain } from "@/lib/chains";

/**
 * The official FWA contract address, pinned to the very top of every page.
 * Copycat tokens are the standard scam in this space — surfacing the one real
 * CA site-wide, with one-click copy and an explorer link, is the defense.
 */
export const OFFICIAL_CA = "0xde1f307359cf9bc2ecea8275dff45a2f41b97777" as const;

export function OfficialCa() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(OFFICIAL_CA);
    } catch {
      // Clipboard API blocked (old browser / permissions) — legacy fallback.
      const ta = document.createElement("textarea");
      ta.value = OFFICIAL_CA;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  const explorer = activeChain.blockExplorers?.default?.url;

  return (
    <div className="ca-bar" data-official-ca>
      <span className="ca-label">Official CA:</span>
      <button
        type="button"
        className="ca-address"
        data-ca-copy
        title="Copy the contract address"
        onClick={copy}
      >
        <span className="mono">{OFFICIAL_CA}</span>
        <span className="ca-feedback" aria-live="polite">{copied ? "✓ Copied" : "⧉"}</span>
      </button>
      {explorer ? (
        <a
          className="ca-scan"
          href={`${explorer}/address/${OFFICIAL_CA}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          BscScan ↗
        </a>
      ) : null}
    </div>
  );
}
