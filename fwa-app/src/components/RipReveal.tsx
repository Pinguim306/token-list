"use client";

import { useEffect, useRef, useState } from "react";
import { NftArt } from "@/components/nft/NftArt";
import { prefersReducedMotion } from "@/components/cards/spring";

export type RipSelected = { positionId: string; symbol: string; tokenId: string };
type Phase = "idle" | "sealed" | "locking" | "tearing" | "emerging" | "revealed";

/**
 * The sealed-pack draw reveal: while randomness is in flight the draw is a
 * foil pack (grade unknown by construction — the word does not exist yet);
 * fulfillment tears the strip off and the selected position slides out of the
 * pack's mouth like a card from a sticker pack. The emergence illusion is
 * plain z-ordering: during "emerging" the card sits BEHIND the opaque pack
 * face and translates upward, so only the part above the mouth shows; once
 * mostly out it jumps in front ("revealed") and settles center-stage. Pure
 * CSS, driven by a data-rip-phase attribute.
 *
 * Live mode follows the on-chain draw state. Demo mode makes the pack itself
 * clickable and runs a scripted timeline, so the animation can be experienced
 * (and tested) without a deployment.
 */
export function RipReveal({
  demo,
  state,
  selected,
}: {
  /** Scripted interactive mode (no chain). */
  demo: boolean;
  /** Live draw state; ignored in demo mode. */
  state: "idle" | "requested" | "fulfilled";
  selected?: RipSelected;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevLive = useRef(state);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Live mode: mirror the chain, inserting the tear between Requested and
  // Fulfilled (skipped under prefers-reduced-motion).
  useEffect(() => {
    if (demo) return;
    if (state === "fulfilled") {
      if (prevLive.current === "requested" && !prefersReducedMotion()) {
        setPhase("tearing");
        later(750, () => setPhase("emerging"));
        later(2000, () => setPhase("revealed"));
      } else {
        setPhase("revealed");
      }
    } else if (state === "requested") {
      setPhase("sealed");
    } else {
      setPhase("idle");
    }
    prevLive.current = state;
  }, [demo, state]);

  const ripDemo = () => {
    if (!demo || (phase !== "idle" && phase !== "revealed")) return;
    if (prefersReducedMotion()) {
      setPhase("revealed");
      return;
    }
    setPhase("sealed");
    later(1100, () => setPhase("locking"));
    later(2300, () => setPhase("tearing"));
    later(3050, () => setPhase("emerging"));
    later(4300, () => setPhase("revealed"));
  };

  const status =
    phase === "idle"
      ? demo
        ? "Tap the pack to rip one open"
        : "Pay the pool price to rip one sealed position"
      : phase === "sealed"
        ? "The keeper answers on its own clock…"
        : phase === "locking"
          ? "Randomness locks in ~1s · seed block +5"
          : phase === "tearing"
            ? "Sealed no more…"
            : phase === "emerging"
              ? "Here it comes…"
              : selected
              ? `Position #${selected.positionId} revealed — keep it or sell it back`
              : "Position revealed — keep it or sell it back";

  const waiting = phase === "sealed" || phase === "locking";

  return (
    <div
      className="pack-stage"
      data-rip-stage
      data-rip-phase={phase}
      role={demo ? "button" : undefined}
      tabIndex={demo ? 0 : undefined}
      aria-label={demo ? "Rip the sealed pack" : undefined}
      onClick={ripDemo}
      onKeyDown={(e) => {
        if (demo && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          ripDemo();
        }
      }}
    >
      <div className="pack" aria-hidden="true">
        <div className="pack-crimp top" />
        <div className="pack-tear" />
        <div className="pack-body">
          <div className="pack-brand">
            F<span>W</span>A
          </div>
          <div className="pack-rule" />
          <div className="pack-sub">One sealed position</div>
          <div className="pack-fine">Grade unknown · keeper × blockhash</div>
        </div>
        <div className="pack-crimp bottom" />
      </div>

      {selected ? (
        <div className="pack-card">
          <NftArt symbol={selected.symbol} tokenId={selected.tokenId} className="pack-card-art" />
          <div className="pack-card-name">
            {selected.symbol} #{selected.tokenId}
          </div>
        </div>
      ) : null}

      <div className="pack-status" role="status">
        {status}
      </div>
      <div className="pack-progress" data-active={waiting}>
        <i />
      </div>
    </div>
  );
}
