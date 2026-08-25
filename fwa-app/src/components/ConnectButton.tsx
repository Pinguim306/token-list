"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { activeChain } from "@/lib/chains";
import { short } from "@/lib/format";

/**
 * Wallets announce themselves via EIP-6963, so every installed extension
 * (MetaMask, Rabby, OKX, …) shows up as its own connector. The
 * button must never auto-pick one — with two wallets installed, whichever
 * announced first would silently win — so it opens a picker instead. The two
 * most common wallets sort first; everything else follows alphabetically.
 */
const PREFERRED_ORDER = ["io.metamask", "io.rabby"];

function sortConnectors(connectors: readonly Connector[]): Connector[] {
  return [...connectors].sort((a, b) => {
    const pa = PREFERRED_ORDER.indexOf(a.id);
    const pb = PREFERRED_ORDER.indexOf(b.id);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? PREFERRED_ORDER.length : pa) - (pb === -1 ? PREFERRED_ORDER.length : pb);
    return a.name.localeCompare(b.name);
  });
}

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);

  // Escape closes the picker; registered only while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (isConnected) {
    const wrongChain = chainId !== activeChain.id;
    return (
      <div className="row">
        {wrongChain && (
          <button
            className="btn"
            disabled={switching}
            onClick={() => switchChain({ chainId: activeChain.id })}
          >
            {switching ? "Switching…" : `Switch to ${activeChain.name}`}
          </button>
        )}
        <button className="btn" onClick={() => disconnect()}>
          {short(address)} · Disconnect
        </button>
      </div>
    );
  }

  const list = sortConnectors(connectors);
  // The connector currently being tried, so only its row shows "Connecting…".
  const pendingUid = isPending ? (variables?.connector as Connector | undefined)?.uid : undefined;

  return (
    <>
      <button
        className="btn primary"
        data-connect-wallet
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Connect Wallet
      </button>

      {open ? (
        <div className="wallet-overlay" data-wallet-picker onClick={() => setOpen(false)}>
          <div
            className="wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Choose a wallet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wallet-modal-head">
              <h3>Choose a wallet</h3>
              <button className="btn ghost" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            {list.length === 0 ? (
              <div className="wallet-empty" data-wallet-empty>
                <p>No wallet detected in this browser.</p>
                <p className="muted">
                  Install{" "}
                  <a href="https://metamask.io" target="_blank" rel="noopener noreferrer">MetaMask</a>{" "}
                  or{" "}
                  <a href="https://rabby.io" target="_blank" rel="noopener noreferrer">Rabby</a>, then
                  reload this page.
                </p>
              </div>
            ) : (
              <ul className="wallet-list">
                {list.map((c) => (
                  <li key={c.uid}>
                    <button
                      className="wallet-option"
                      data-wallet-option={c.id}
                      disabled={isPending}
                      onClick={() => connect({ connector: c })}
                    >
                      {c.icon ? (
                        // EIP-6963 icons are data: URIs supplied by the wallet itself.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="wallet-icon" src={c.icon} alt="" />
                      ) : (
                        <span className="wallet-icon wallet-icon-fallback" aria-hidden="true">◆</span>
                      )}
                      <span>{c.name}</span>
                      {pendingUid === c.uid ? <span className="muted">Connecting…</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {error ? (
              <p className="field-error" role="alert">
                {(error as { shortMessage?: string }).shortMessage ?? error.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
