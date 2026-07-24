"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { activeChain } from "@/lib/chains";
import { short } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    const wrongChain = chainId !== activeChain.id;
    return (
      <div className="row">
        {wrongChain && <span className="badge warn">Wrong network</span>}
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
