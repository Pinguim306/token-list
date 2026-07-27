/**
 * Minimal damped-spring integrator (semi-implicit Euler), the same model
 * Motion/Framer expose as { stiffness, damping }. Hand-rolled because the two
 * consumers here (carousel snap, card tilt) need nothing else from the
 * library — no reason to ship it.
 */
export type SpringState = { x: number; v: number };

export function stepSpring(
  s: SpringState,
  target: number,
  dt: number,
  stiffness = 170,
  damping = 26,
): SpringState {
  // Clamp dt: a background tab can hand us a multi-second frame, and a big dt
  // makes the integrator overshoot wildly instead of settling.
  const t = Math.min(dt, 1 / 30);
  const a = stiffness * (target - s.x) - damping * s.v;
  const v = s.v + a * t;
  const x = s.x + v * t;
  return { x, v };
}

export function isSettled(s: SpringState, target: number, epsilon = 0.001): boolean {
  return Math.abs(s.x - target) < epsilon && Math.abs(s.v) < epsilon;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
