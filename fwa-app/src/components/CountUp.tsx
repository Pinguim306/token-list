"use client";

import { useEffect, useState } from "react";

export function CountUp({ value, decimals = 0, duration = 950 }: { value: number; decimals?: number; duration?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(value)) return;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setN(value * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n.toLocaleString(undefined, { maximumFractionDigits: decimals })}</>;
}
