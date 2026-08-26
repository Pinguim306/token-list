"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { encodeFunctionData, maxUint256 } from "viem";
import { readContract } from "wagmi/actions";
import { pool, backing } from "@/lib/contracts";
import { activeChain } from "@/lib/chains";
import { config as wagmiConfig } from "@/lib/wagmi";
import { DRAW_STATE, fmt, fmtDuration, short } from "@/lib/format";
import { DEMO, demo } from "@/lib/demo";
import {
  CHECKOUT,
  TREASURY,
  PACKRIP,
  RIP_LIVE,
  packRipAbi,
  PACK_PRICE_HYPE,
  PACK_ESCROW_HYPE,
  MAX_PACKS_PER_TX,
  totalPriceWei,
  totalPriceHype,
  pickPackStocks,
  type PackPull,
} from "@/lib/checkout";
import { collectionSymbol } from "@/lib/usePositions";
import { ACTIVE_DSTOCKS } from "@/lib/dstockCatalog";
import { NftArt } from "@/components/nft/NftArt";
import { RipReveal, type RipSelected } from "@/components/RipReveal";

type Draw = {
  buyer: `0x${string}`; price: bigint; totalWeightSnapshot: bigint; randomWord: bigint;
  requestedAt: bigint; fulfilledAt: bigint; selectedId: bigint; state: number;
};

/** The three settlements a ripped pack can take (plus finalize's default). */
type Outcome = "kept" | "sold" | "shares";

export function DrawPanel() {
  const { address, isConnected, chainId } = useAccount();

  // Demo checkout ("marretado"): with a wallet connected, the sample draw
  // gives way to a LIVE purchase — a real native-HYPE transfer of the pack
  // price to the treasury — followed by a client-simulated draw + settlement
  // that mirrors the contract flow. Visitors without a wallet keep the
  // tap-to-preview sample experience (which is also what the e2e suite runs).
  const checkout = CHECKOUT && isConnected;
  const showSample = DEMO && !checkout;

  const { data: decimals } = useReadContract({ ...backing, functionName: "decimals", query: { enabled: !DEMO } });
  const dec = DEMO ? demo.decimals : decimals ?? 18;

  const { data } = useReadContracts({
    contracts: [
      { ...pool, functionName: "drawCount" },
      { ...pool, functionName: "drawInFlight" },
      { ...pool, functionName: "settlementWindow" },
      { ...pool, functionName: "requestTimeout" },
    ],
    query: { refetchInterval: 5000, enabled: !DEMO },
  });
  const drawCount = DEMO ? demo.draw.drawId : (data?.[0]?.result as bigint | undefined);
  const inFlight = DEMO ? demo.drawInFlight : (data?.[1]?.result as boolean | undefined);
  const settlementWindow = DEMO ? demo.settlementWindow : ((data?.[2]?.result as bigint | undefined) ?? 86_400n);
  const requestTimeout = DEMO ? demo.requestTimeout : ((data?.[3]?.result as bigint | undefined) ?? 3_600n);

  const hasDraw = !!drawCount && drawCount > 0n;
  const { data: draw } = useReadContract({
    ...pool, functionName: "draws", args: hasDraw ? [drawCount!] : undefined,
    query: { enabled: !DEMO && hasDraw, refetchInterval: 5000 },
  });
  // The sample draw renders only while the checkout is dormant — once a wallet
  // is connected the panel belongs to the user's own purchase.
  const d: Draw | undefined = DEMO
    ? showSample
      ? ({ buyer: demo.draw.buyer as `0x${string}`, price: demo.draw.price, totalWeightSnapshot: 0n, randomWord: 0n, requestedAt: 0n, fulfilledAt: 0n, selectedId: BigInt(demo.draw.selectedId), state: demo.draw.state } as Draw)
      : undefined
    : (draw as unknown as Draw | undefined);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: mining } = useWaitForTransactionReceipt({ hash });
  const busy = isPending || mining || DEMO;

  // ---- Demo checkout state machine: pay (real) -> reveal -> settle (simulated)
  const {
    sendTransaction,
    data: payHash,
    isPending: paySending,
    error: payError,
    reset: payReset,
  } = useSendTransaction();
  const { isLoading: payMining, isSuccess: paid } = useWaitForTransactionReceipt({
    hash: payHash,
    query: { enabled: !!payHash },
  });
  const { switchChainAsync } = useSwitchChain();
  // How many packs the next purchase buys (1..MAX_PACKS_PER_TX) — one HYPE
  // transfer of price × qty. Captured in a ref at buy time so changing the
  // stepper while the payment mines cannot change how many packs it opens.
  const [qty, setQty] = useState(1);
  const boughtQty = useRef(1);
  const [won, setWon] = useState<PackPull[] | null>(null);
  const [outcomes, setOutcomes] = useState<(Outcome | null)[]>([]);

  // The payment receipt is the "randomness": one confirmed transfer reveals
  // the whole batch — each pack pulls a deliverable dStock, rarity-weighted.
  useEffect(() => {
    if (paid && !won) {
      const pulls = pickPackStocks(boughtQty.current);
      setWon(pulls);
      setOutcomes(Array(pulls.length).fill(null));
    }
  }, [paid, won]);

  const buy = async () => {
    payReset();
    setWon(null);
    setOutcomes([]);
    boughtQty.current = qty;
    try {
      if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      if (RIP_LIVE) {
        // On-chain checkout: ripPacks escrows 85% for the Keep/Sell decision.
        sendTransaction({
          to: PACKRIP,
          value: totalPriceWei(qty),
          data: encodeFunctionData({ abi: packRipAbi, functionName: "ripPacks", args: [BigInt(qty)] }),
          chainId: activeChain.id,
        });
      } else {
        sendTransaction({ to: TREASURY, value: totalPriceWei(qty), chainId: activeChain.id });
      }
    } catch {
      // user rejected the network switch — nothing sent, nothing to clean up
    }
  };

  const clampQty = (n: number) => Math.max(1, Math.min(MAX_PACKS_PER_TX, Math.floor(n) || 1));

  // ---- Settlement. Legacy demo: outcomes are UI state. With PackRip live,
  // all three choices are REAL transactions first (keep mints the PackCards
  // collectible and releases the escrow to the treasury; sellBack market-buys
  // $HFWA with it and delivers the tokens; takeShares delivers the escrow's
  // value in the drawn dStock at the live HyperCore price) and the outcome is
  // recorded once the transaction is sent.
  const {
    sendTransaction: sendSettleTx,
    isPending: settleSending,
    reset: settleReset,
  } = useSendTransaction();
  const [settleBusy, setSettleBusy] = useState(false);
  const applyOutcome = (idx: number | "all", o: Outcome) =>
    setOutcomes((prev) => prev.map((v, j) => (idx === "all" || j === idx ? (v ?? o) : v)));

  const settleOnChain = async (idx: number | "all", o: Outcome) => {
    const targets = won
      ? won.map((p, j) => ({ p, j })).filter(({ j }) => outcomes[j] === null && (idx === "all" || j === idx))
      : [];
    const count = targets.length;
    if (count === 0) return;
    setSettleBusy(true);
    try {
      let data: `0x${string}`;
      if (o === "sold") {
        // Quote the swap and give ourselves a 3% slippage floor.
        const [, out] = (await readContract(wagmiConfig, {
          address: PACKRIP,
          abi: packRipAbi,
          functionName: "quoteSellBack",
          args: [address!, BigInt(count)],
        })) as readonly [bigint, bigint];
        data = encodeFunctionData({
          abi: packRipAbi, functionName: "sellBack", args: [BigInt(count), (out * 97n) / 100n],
        });
      } else if (o === "shares") {
        // Take-the-shares runs per stock: every targeted pack here shares one
        // drawn stock (per-card button, or "all" when the pulls agree).
        const stock = targets[0].p.stock;
        const [, sharesOut] = (await readContract(wagmiConfig, {
          address: PACKRIP,
          abi: packRipAbi,
          functionName: "quoteTakeShares",
          args: [address!, BigInt(count), stock.address],
        })) as readonly [bigint, bigint, bigint, bigint, bigint];
        data = encodeFunctionData({
          abi: packRipAbi,
          functionName: "takeShares",
          args: [BigInt(count), stock.address, (sharesOut * 98n) / 100n],
        });
      } else {
        data = encodeFunctionData({
          abi: packRipAbi, functionName: "keep", args: [[...targets.map(({ p }) => p.stock.address)]],
        });
      }
      settleReset();
      sendSettleTx(
        { to: PACKRIP, data, chainId: activeChain.id },
        { onSuccess: () => applyOutcome(idx, o), onSettled: () => setSettleBusy(false) },
      );
    } catch {
      setSettleBusy(false); // quote failed or user rejected — outcome stays open
    }
  };

  const settle = (i: number, o: Outcome) =>
    RIP_LIVE ? void settleOnChain(i, o) : setOutcomes((prev) => prev.map((v, j) => (j === i ? (v ?? o) : v)));
  const settleAll = (o: Outcome) =>
    RIP_LIVE ? void settleOnChain("all", o) : setOutcomes((prev) => prev.map((v) => v ?? o));

  // "Take all shares" needs a single stock across the unsettled pulls (one
  // takeShares call is per-stock); mixed pulls settle shares per card.
  const unsettledStocks = won
    ? new Set(won.filter((_, j) => outcomes[j] === null).map((p) => p.stock.address))
    : new Set<string>();
  const sharesAllOk = !RIP_LIVE || unsettledStocks.size <= 1;

  const paying = paySending || payMining;
  const explorer = activeChain.blockExplorers?.default?.url;

  const allSettled = !!won && won.length > 0 && outcomes.every((o) => o !== null);
  const stateName = checkout
    ? won
      ? allSettled
        ? "Settled"
        : "Fulfilled"
      : paying
        ? "Requested"
        : "Idle"
    : d
      ? DRAW_STATE[d.state] ?? "Idle"
      : "Idle";
  const isBuyer = !!d && !!address && d.buyer.toLowerCase() === address.toLowerCase();
  const fulfilled = d?.state === 2;
  const requested = d?.state === 1;

  // A 1s clock, started client-side only so SSR markup never contains a
  // wall-clock value (hydration would mismatch). Until the first tick the
  // deadline UI simply doesn't render.
  const [nowMs, setNowMs] = useState<number | null>(null);
  // Demo anchor: pretend the draw was fulfilled 14 minutes ago, so the
  // countdown reads "23h 46m" — the number from the settlement-window lesson.
  const demoAnchor = useRef<number>(0);
  useEffect(() => {
    demoAnchor.current = Date.now() - 14 * 60_000;
    const tick = () => setNowMs(Date.now());
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  const fulfilledAtMs = DEMO ? demoAnchor.current : d ? Number(d.fulfilledAt) * 1000 : 0;
  const requestedAtMs = DEMO ? demoAnchor.current : d ? Number(d.requestedAt) * 1000 : 0;
  const settleDeadline = fulfilledAtMs + Number(settlementWindow) * 1000;
  const expireDeadline = requestedAtMs + Number(requestTimeout) * 1000;
  // Pre-hydration (nowMs null) nothing is considered expired.
  const windowClosed = fulfilled && nowMs !== null && nowMs > settleDeadline;
  const randomnessOverdue = requested && nowMs !== null && nowMs > expireDeadline;

  const deadline =
    nowMs === null
      ? null
      : fulfilled
        ? windowClosed
          ? { tone: "late", text: "Settlement window closed — anyone can finalize the default outcome (Keep)." }
          : {
              tone: settleDeadline - nowMs < 3_600_000 ? "warn" : "ok",
              text: `${isBuyer ? "Yours alone" : "Buyer's call"} for ${fmtDuration(settleDeadline - nowMs)} — after that, anyone can finalize (default: Keep).`,
            }
        : requested
          ? randomnessOverdue
            ? { tone: "late", text: "Randomness overdue — anyone can expire the draw and refund the buyer." }
            : {
                tone: "ok",
                text: `Randomness due within ${fmtDuration(expireDeadline - nowMs)} — the keeper answers on its own clock.`,
              }
          : null;

  // The revealed card needs the selected position's collection + tokenId.
  const { data: selPos } = useReadContract({
    ...pool,
    functionName: "positions",
    args: fulfilled && d ? [d.selectedId] : undefined,
    query: { enabled: !DEMO && fulfilled },
  });
  const selected: RipSelected | undefined = checkout
    ? won && won.length > 0
      ? { positionId: won[0].serial.toString(), symbol: won[0].stock.ticker, tokenId: won[0].serial.toString() }
      : undefined
    : showSample
      ? (() => {
          const p = demo.positions.find((p) => p.id === BigInt(demo.draw.selectedId));
          return p
            ? { positionId: p.id.toString(), symbol: collectionSymbol(p.asset), tokenId: p.tokenId.toString() }
            : undefined;
        })()
      : selPos && d
        ? (() => {
            // positions(id) tuple: [depositor, asset, tokenId, backing, weight, active, feeDebt]
            const t = selPos as unknown as [string, string, bigint, bigint, bigint, boolean, bigint];
            return { positionId: d.selectedId.toString(), symbol: collectionSymbol(t[1]), tokenId: t[2].toString() };
          })()
        : undefined;

  // Standing bid the buyer may exercise per pack: the escrowed 85% of the
  // pack price (same for every pack). The totals feed the summary.
  const escrowHype = (n: number) => (n === 1 ? PACK_ESCROW_HYPE : (Number(PACK_ESCROW_HYPE) * n).toFixed(2));
  const keptCount = outcomes.filter((o) => o === "kept").length;
  const soldCount = outcomes.filter((o) => o === "sold").length;
  const sharesCount = outcomes.filter((o) => o === "shares").length;
  const multi = !!won && won.length > 1;

  return (
    <div className="card feature">
      <h2><span className="ic">◈</span> Rip a pack <span className="badge hot" style={{ marginLeft: 8 }}>{stateName}</span></h2>

      <RipReveal
        demo={showSample}
        state={checkout ? (won ? "fulfilled" : paying ? "requested" : "idle") : fulfilled ? "fulfilled" : requested ? "requested" : "idle"}
        selected={selected}
      />

      {deadline ? (
        <p className={`deadline ${deadline.tone}`} data-draw-deadline role="status">
          <span className="deadline-clock" aria-hidden="true">◷</span>
          {deadline.text}
        </p>
      ) : null}

      {checkout ? (
        <>
          <div className="stat"><span>Pack price</span><b>{PACK_PRICE_HYPE} HYPE</b></div>
          <div className="stat" data-total-price>
            <span>Total ({won ? won.length : qty} pack{(won ? won.length : qty) > 1 ? "s" : ""})</span>
            <b>{totalPriceHype(won ? won.length : qty)} HYPE</b>
          </div>
          <div className="stat"><span>Treasury</span><b className="mono">{short(TREASURY)}</b></div>
          {payHash && (
            <div className="stat">
              <span>Payment tx</span>
              <b className="mono">
                {explorer ? (
                  <a href={`${explorer}/tx/${payHash}`} target="_blank" rel="noreferrer">{short(payHash)}</a>
                ) : (
                  short(payHash)
                )}
              </b>
            </div>
          )}
          {won && (
            <div className="stat">
              <span>{multi ? "Escrowed for your call (total)" : "Escrowed for your call"}</span>
              <b>{escrowHype(won.length)} HYPE</b>
            </div>
          )}
        </>
      ) : (
        <>
          {d && <div className="stat"><span>Buyer</span><b className="mono">{short(d.buyer)}</b></div>}
          {d && <div className="stat"><span>Escrowed price</span><b>{fmt(d.price, dec)}</b></div>}
          {hasDraw && !DEMO && <div className="stat"><span>Draw #</span><b>{drawCount!.toString()}</b></div>}
          {showSample && <div className="stat"><span>Draw #</span><b>{demo.draw.drawId.toString()}</b></div>}
        </>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        {CHECKOUT ? (
          <>
            <div className="qty-stepper" data-qty-stepper role="group" aria-label="How many packs">
              <button
                className="btn"
                data-qty-minus
                aria-label="One pack fewer"
                disabled={paying || qty <= 1}
                onClick={() => setQty((q) => clampQty(q - 1))}
              >
                −
              </button>
              <input
                data-qty
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_PACKS_PER_TX}
                value={qty}
                disabled={paying}
                aria-label={`Packs to buy (1–${MAX_PACKS_PER_TX})`}
                onChange={(e) => setQty(clampQty(Number(e.target.value)))}
              />
              <button
                className="btn"
                data-qty-plus
                aria-label="One pack more"
                disabled={paying || qty >= MAX_PACKS_PER_TX}
                onClick={() => setQty((q) => clampQty(q + 1))}
              >
                +
              </button>
            </div>
            <button
              className="btn primary"
              data-buy-pack
              disabled={!isConnected || paying}
              title={!isConnected ? "Connect your wallet to buy" : undefined}
              onClick={buy}
            >
              {paySending
                ? "Confirm in wallet…"
                : payMining
                  ? "Paying…"
                  : qty === 1
                    ? `Rip a pack · ${PACK_PRICE_HYPE} HYPE`
                    : `Rip ${qty} packs · ${totalPriceHype(qty)} HYPE`}
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={busy || inFlight}
            onClick={() => writeContract({ ...pool, functionName: "startDraw", args: [maxUint256] })}>
            Rip a pack
          </button>
        )}
        <button
          className="btn"
          disabled={checkout ? !won || allSettled || settleBusy || settleSending : busy || !fulfilled || windowClosed || (!isBuyer && !DEMO)}
          title={checkout && !won ? "Buy a pack first" : RIP_LIVE ? "Keep: you receive the pack card (an on-chain collectible of your pull)" : undefined}
          onClick={() =>
            checkout
              ? settleAll("kept")
              : writeContract({ ...pool, functionName: "settle", args: [drawCount!, 0] })
          }
        >
          {checkout && multi ? "Keep all" : "Keep the card"}
        </button>
        <button
          className="btn"
          disabled={checkout ? !won || allSettled || settleBusy || settleSending : busy || !fulfilled || windowClosed || (!isBuyer && !DEMO)}
          title={checkout && !won ? "Buy a pack first" : RIP_LIVE ? "Sell back: the escrow buys $HFWA on the market and sends it to you" : undefined}
          onClick={() =>
            checkout
              ? settleAll("sold")
              : writeContract({ ...pool, functionName: "settle", args: [drawCount!, 1] })
          }
        >
          {checkout && multi ? "Sell all back" : "Sell back"}
        </button>
        {checkout ? (
          <button
            className="btn"
            data-take-shares
            disabled={!won || allSettled || settleBusy || settleSending || !sharesAllOk}
            title={
              !won
                ? "Buy a pack first"
                : !sharesAllOk
                  ? "Your pulls drew different stocks — take shares per card below"
                  : "Take the shares: the escrow's value is delivered in the drawn stock's tokens at the live HyperCore price"
            }
            onClick={() => settleAll("shares")}
          >
            {multi ? "Take all shares" : "Take the shares"}
          </button>
        ) : null}
      </div>

      {checkout && won && multi ? (
        <ul className="won-grid" data-won-grid>
          {won.map((p, i) => (
            <li key={`${p.stock.ticker}-${p.serial}`} className="won-card" data-won-card={p.serial.toString()}>
              <span className="won-thumb">
                <NftArt symbol={p.stock.ticker} tokenId={p.serial.toString()} />
              </span>
              <div className="won-meta">
                <b>{p.stock.ticker} #{p.serial}</b>
                <span className="muted">
                  {p.stock.priceUsd ? `$${p.stock.priceUsd} · ` : ""}escrow {PACK_ESCROW_HYPE} HYPE
                </span>
              </div>
              {outcomes[i] ? (
                <span className={`badge ${outcomes[i] === "kept" ? "hot" : ""}`}>
                  {outcomes[i] === "kept" ? "Kept" : outcomes[i] === "sold" ? "Sold" : "Shares"}
                </span>
              ) : (
                <div className="row">
                  <button className="btn" disabled={settleBusy || settleSending} onClick={() => settle(i, "kept")}>Keep</button>
                  <button className="btn" disabled={settleBusy || settleSending} onClick={() => settle(i, "sold")}>Sell</button>
                  <button className="btn" disabled={settleBusy || settleSending} title={`Receive the escrow's value in ${p.stock.symbol} tokens`} onClick={() => settle(i, "shares")}>Shares</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row" style={{ marginTop: 8 }}>
        {/* Contract-mirrored gating: finalize only opens once the settlement
            window has passed, expire only once randomness is overdue — the
            user should never pay gas to learn "too early". */}
        <button className="btn ghost" disabled={busy || !fulfilled || !windowClosed}
          title={checkout ? "Simulated in the demo — settlement is instant" : fulfilled && !windowClosed ? "Opens when the settlement window closes" : undefined}
          onClick={() => writeContract({ ...pool, functionName: "finalize", args: [drawCount!] })}>
          Finalize
        </button>
        <button className="btn ghost" disabled={busy || !requested || !randomnessOverdue}
          title={checkout ? "Simulated in the demo — randomness is instant" : requested && !randomnessOverdue ? "Opens if randomness misses its deadline" : undefined}
          onClick={() => writeContract({ ...pool, functionName: "expireDraw", args: [drawCount!] })}>
          Expire · refund
        </button>
      </div>

      {checkout && payError ? (
        <p className="field-error" role="alert">
          Payment failed: {(payError as { shortMessage?: string }).shortMessage ?? payError.message}
        </p>
      ) : null}
      {checkout && allSettled && won ? (
        <p className="notice ok" role="status" data-settle-summary>
          {multi
            ? `${won.length} packs settled — ${keptCount} kept as cards, ${soldCount} sold back${
                soldCount > 0 ? ` (${escrowHype(soldCount)} HYPE of escrow bought $HFWA for you)` : ""
              }${sharesCount > 0 ? `, ${sharesCount} taken as shares (escrow value delivered in the drawn stocks)` : ""}.${RIP_LIVE ? "" : " (Settlement simulated.)"}`
            : outcomes[0] === "kept"
              ? `Pack kept — the ${won[0].stock.ticker} #${won[0].serial} card is yours${RIP_LIVE ? " (PackCards NFT minted to your wallet)" : ""}.${RIP_LIVE ? "" : " (Settlement simulated.)"}`
              : outcomes[0] === "sold"
                ? `Sold back — the ${PACK_ESCROW_HYPE} HYPE escrow market-bought $HFWA and sent it to you.${RIP_LIVE ? "" : " (Settlement simulated.)"}`
                : `Shares taken — the ${PACK_ESCROW_HYPE} HYPE escrow's value was delivered in ${won[0].stock.symbol} tokens at the live HyperCore price.${RIP_LIVE ? "" : " (Settlement simulated.)"}`}
        </p>
      ) : null}

      <p className="muted" style={{ marginTop: 12 }}>
        {checkout
          ? RIP_LIVE
            ? `Live checkout: buying pays the pack price × quantity (up to ${MAX_PACKS_PER_TX} packs per transaction) on ${activeChain.name} — 85% is escrowed on-chain for your call, three ways. Keep mints you the pack card (an on-chain collectible of your pull). Sell back market-buys $HFWA with the escrow and sends the tokens to you. Take the shares delivers the escrow's value in the drawn stock's own tokens (HyperCore-linked dStocks) at the live on-chain price. Each pack pulls one deliverable tokenized stock, rarity-weighted. Pull pool: ${ACTIVE_DSTOCKS.map((d) => d.ticker).join(", ")}.`
            : `Live demo checkout: buying sends the pack price × quantity (up to ${MAX_PACKS_PER_TX} packs per transaction) in one HYPE transfer on ${activeChain.name} to the FWA treasury. Each pack pulls a real tokenized stock, then settles one of three ways — Keep the card, Sell back for $HFWA, or Take the shares — simulated exactly as the contracts run them. Pull pool: ${ACTIVE_DSTOCKS.map((d) => d.ticker).join(", ")}.`
          : "Randomness mixes a keeper commit-reveal chain with a future blockhash (Pyth Entropy-upgradable at the router). While “Requested”, the pool is frozen (freeze-at-request); once “Fulfilled”, the buyer keeps the pack or sells it back for the standing bid."}
      </p>
    </div>
  );
}
