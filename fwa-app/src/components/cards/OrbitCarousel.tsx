"use client";

import { useEffect, useRef, useState } from "react";
import { PositionCard, type CardData } from "./PositionCard";
import { stepSpring, isSettled, prefersReducedMotion, type SpringState } from "./spring";

/** How many cards may exist in the DOM at once (a window around the active
 *  index, same virtualization budget fwa.fun uses). */
const DOM_WINDOW = 9;
/** Horizontal distance between neighbouring cards, px. */
const SPACING = 168;
/** Pointer movement beyond this is a drag, not a click. */
const DRAG_THRESHOLD_PX = 6;

/**
 * The fwa.fun-style orbit carousel: a home-grown strip of absolutely
 * positioned cards whose transform/z-index/opacity are computed per frame from
 * their distance to the (fractional) active index — that falloff is what reads
 * as depth. Dragging uses Pointer Events with setPointerCapture and
 * `touch-action: pan-y` so vertical page scroll still works on mobile;
 * releasing snaps to the nearest card on a damped spring.
 */
export function OrbitCarousel({ cards }: { cards: CardData[] }) {
  const max = cards.length - 1;
  // Start on the middle card so the fan spreads symmetrically on first paint.
  const mid = Math.floor(max / 2);

  const [active, setActive] = useState(mid); // settled integer index (for a11y + window)
  const [flippedId, setFlippedId] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const spring = useRef<SpringState>({ x: mid, v: 0 });
  const targetIdx = useRef(mid);
  const raf = useRef(0);
  const last = useRef(0);
  const drag = useRef<{ pointerId: number; startX: number; startIdx: number; moved: boolean } | null>(null);

  /** Write every card's transform from the current fractional position. */
  const paint = (pos: number) => {
    const track = trackRef.current;
    if (!track) return;
    for (const el of Array.from(track.children) as HTMLElement[]) {
      const idx = Number(el.dataset.logicalIndex);
      const off = idx - pos;
      const abs = Math.abs(off);
      el.style.transform =
        `translateX(calc(-50% + ${(off * SPACING).toFixed(2)}px)) translateY(-50%) ` +
        `scale(${Math.max(0.6, 1 - abs * 0.13).toFixed(3)}) rotate(${(off * 4).toFixed(2)}deg)`;
      el.style.zIndex = String(100 - Math.round(abs * 10));
      el.style.opacity = String(Math.max(0, 1 - abs * 0.28).toFixed(3));
      el.style.pointerEvents = abs > 2.5 ? "none" : "";
    }
  };

  const loop = (now: number) => {
    const dt = (now - last.current) / 1000 || 1 / 60;
    last.current = now;
    spring.current = stepSpring(spring.current, targetIdx.current, dt, 170, 26);
    paint(spring.current.x);
    if (!isSettled(spring.current, targetIdx.current)) {
      raf.current = requestAnimationFrame(loop);
    } else {
      spring.current = { x: targetIdx.current, v: 0 };
      paint(targetIdx.current);
      setActive(targetIdx.current);
    }
  };

  const goTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(max, idx));
    targetIdx.current = clamped;
    setActive(clamped);
    if (prefersReducedMotion()) {
      spring.current = { x: clamped, v: 0 };
      paint(clamped);
      return;
    }
    cancelAnimationFrame(raf.current);
    last.current = performance.now();
    raf.current = requestAnimationFrame(loop);
  };

  // Initial paint + repaint when the container resizes (same reason fwa.fun
  // carries a ResizeObserver: absolute positioning goes stale on reflow).
  useEffect(() => {
    paint(spring.current.x);
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => paint(spring.current.x));
    ro.observe(track);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    cancelAnimationFrame(raf.current);
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startIdx: spring.current.x, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
      d.moved = true;
      // Capture only once it IS a drag. Capturing on pointerdown would
      // retarget the subsequent click to the track, so the card's flip
      // button would never receive it.
      trackRef.current?.setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    // 1 card per SPACING px, dragged position clamped with a little rubber-band
    const raw = d.startIdx - dx / SPACING;
    const clamped = Math.max(-0.35, Math.min(max + 0.35, raw));
    spring.current = { x: clamped, v: 0 };
    paint(clamped);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.moved) goTo(Math.round(spring.current.x));
  };

  const onCardActivate = (idx: number, id: string) => {
    // A drag that ends on a card must not also flip it.
    if (drag.current?.moved) return;
    if (idx !== targetIdx.current) {
      goTo(idx);
      return;
    }
    setFlippedId((cur) => (cur === id ? null : id));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(targetIdx.current - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(targetIdx.current + 1);
    }
  };

  // Virtualization window around the active card.
  const half = Math.floor(DOM_WINDOW / 2);
  const visible = cards
    .map((card, idx) => ({ card, idx }))
    .filter(({ idx }) => Math.abs(idx - active) <= half);

  return (
    <div
      className="orbit"
      data-carousel-orbit
      data-active={active}
      role="group"
      aria-roledescription="carousel"
      aria-label="Position cards"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div
        ref={trackRef}
        className="orbit-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {visible.map(({ card, idx }) => (
          <div key={card.id} className="orbit-item" data-carousel-card data-logical-index={idx}>
            <PositionCard
              card={card}
              flipped={flippedId === card.id}
              onFlip={() => onCardActivate(idx, card.id)}
              interactive={idx === active}
            />
          </div>
        ))}
      </div>

      <div className="orbit-dots" role="tablist" aria-label="Select card">
        {cards.map((card, idx) => (
          <button
            key={card.id}
            type="button"
            role="tab"
            aria-selected={idx === active}
            aria-label={`Card ${idx + 1} of ${cards.length}`}
            className="orbit-dot"
            data-current={idx === active}
            onClick={() => goTo(idx)}
          />
        ))}
      </div>
    </div>
  );
}
