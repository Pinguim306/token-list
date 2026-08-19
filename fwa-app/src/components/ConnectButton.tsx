"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { activeChain } from "@/lib/chains";
import { short } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

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

  const connector = connectors[0];
  return (
    <button
      className="btn primary"
      disabled={isPending || !connector}
      onClick={() => connector && connect({ connector })}
    >
      {isPending ? "Connecting…" : connector ? "Connect Wallet" : "No wallet detected"}
    </button>
  );
}
