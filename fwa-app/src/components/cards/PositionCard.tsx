"use client";

import { useEffect, useRef } from "react";
import { stepSpring, isSettled, prefersReducedMotion, type SpringState } from "./spring";

export type CardData = {
  id: string;
  tokenId: string;
  collection: string;
  symbol: string;
  backing: string;
  bid: string;
  odds: string;
  crown: boolean;
};

const MAX_TILT_DEG = 7;

/**
 * A trading-card built the way fwa.fun builds theirs: no canvas, no WebGL.
 *
 * - Flip: CSS 3D only. The wrapper carries the perspective, the flipper has
 *   `transform-style: preserve-3d`, both faces hide their backface, and the
 *   back starts at rotateY(180deg) — flipping is just toggling the flipper
 *   between 0 and 180.
 * - Tilt: pointer position → target rotateX/rotateY, eased by a damped spring
 *   in a rAF loop. The same pointer position feeds --holo-x/--holo-y.
 * - Holo: three stacked gradients on the back — a 115° rainbow in color-dodge,
 *   foil microlines in color-dodge, and a radial glow in soft-light whose
 *   centre follows the cursor. Blend modes, not shaders.
 */
export function PositionCard({
  card,
  flipped,
  onFlip,
  interactive = true,
}: {
  card: CardData;
  flipped: boolean;
  onFlip?: () => void;
  interactive?: boolean;
}) {
  const tiltRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const springs = useRef<{ rx: SpringState; ry: SpringState }>({
    rx: { x: 0, v: 0 },
    ry: { x: 0, v: 0 },
  });
  const target = useRef({ rx: 0, ry: 0 });
  const last = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const loop = (now: number) => {
    const el = tiltRef.current;
    if (!el) return;
    const dt = (now - last.current) / 1000 || 1 / 60;
    last.current = now;

    const s = springs.current;
    s.rx = stepSpring(s.rx, target.current.rx, dt, 210, 22);
    s.ry = stepSpring(s.ry, target.current.ry, dt, 210, 22);
    el.style.transform = `rotateX(${s.rx.x.toFixed(3)}deg) rotateY(${s.ry.x.toFixed(3)}deg)`;

    if (!isSettled(s.rx, target.current.rx, 0.01) || !isSettled(s.ry, target.current.ry, 0.01)) {
      raf.current = requestAnimationFrame(loop);
    }
  };

  const kick = () => {
    cancelAnimationFrame(raf.current);
    last.current = performance.now();
    raf.current = requestAnimationFrame(loop);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || prefersReducedMotion()) return;
    const el = tiltRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // -0.5..0.5 across the card
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;

    target.current = { rx: -ny * MAX_TILT_DEG * 2, ry: nx * MAX_TILT_DEG * 2 };
    el.style.setProperty("--holo-x", `${((nx + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--holo-y", `${((ny + 0.5) * 100).toFixed(1)}%`);
    kick();
  };

  const onPointerLeave = () => {
    target.current = { rx: 0, ry: 0 };
    if (!prefersReducedMotion()) kick();
  };

  return (
    <div className="pcard" data-card-id={card.id}>
      <div ref={tiltRef} className="pcard-tilt" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
        <button
          type="button"
          className="pcard-flip"
          data-flipped={flipped}
          aria-pressed={flipped}
          aria-label={`Position ${card.id} card — ${flipped ? "showing stats, activate to see the front" : "activate to reveal stats"}`}
          onClick={onFlip}
          disabled={!onFlip}
        >
          {/* front */}
          <span className="pcard-face pcard-front">
            <span className="pcard-head">
              <span className="pcard-sym">{card.symbol}</span>
              {card.crown ? <span aria-hidden="true">👑</span> : null}
            </span>
            <span className="pcard-art" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <path d="M4 15l4.2-4.2a1.5 1.5 0 0 1 2.1 0L16 16.5M14 13.5l1.9-1.9a1.5 1.5 0 0 1 2.1 0L20 13.5" />
                <circle cx="9.5" cy="8.5" r="1.4" />
              </svg>
            </span>
            <span className="pcard-title">#{card.tokenId}</span>
            <span className="pcard-subtitle">{card.collection}</span>
            <span className="pcard-foot">
              <span>Backing</span>
              <b>{card.backing}</b>
            </span>
          </span>

          {/* back */}
          <span className="pcard-face pcard-back">
            <span className="holo-rainbow" aria-hidden="true" />
            <span className="holo-lines" aria-hidden="true" />
            <span className="holo-glow" aria-hidden="true" />
            <span className="pcard-back-body">
              <span className="pcard-back-title">Position #{card.id}</span>
              <span className="pcard-stat">
                <span>Draw odds</span>
                <b>{card.odds}</b>
              </span>
              <span className="pcard-stat">
                <span>Standing bid</span>
                <b>{card.bid}</b>
              </span>
              <span className="pcard-stat">
                <span>Backing</span>
                <b>{card.backing}</b>
              </span>
              <span className="pcard-back-note">
                {card.crown ? "Wears the crown — tithes every fee" : "Keep it, or sell it back"}
              </span>
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
