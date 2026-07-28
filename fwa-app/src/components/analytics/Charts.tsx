"use client";

import { useState } from "react";

/**
 * Small, dependency-free SVG charts for the analytics dashboard, following the
 * dataviz method: thin marks with 4px rounded data-ends, 2px surface gaps,
 * recessive axes, selective direct labels, and a per-mark hover tooltip. The
 * app runs a single dark theme, so colors are the app tokens read against the
 * dark surface (validated — the categorical/status set clears the CVD check;
 * identity is carried by direct labels, never color alone).
 */

type Tip = { x: number; y: number; label: string } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs whitespace-nowrap text-ink shadow-sm"
      style={{ left: tip.x, top: tip.y - 8 }}
      role="status"
    >
      {tip.label}
    </div>
  );
}

// ------------------------------------------------------------------ bar chart
export type Bar = { label: string; value: number; display: string; emphasis?: boolean; sub?: string };

/** Horizontal bars, sorted by the caller. One hue; an emphasized bar (e.g. the
 *  Crown) gets the crown token, the rest a recessive accent. Direct value
 *  labels make every bar readable without color. */
export function BarChart({ data, unit, ariaLabel }: { data: Bar[]; unit?: string; ariaLabel: string }) {
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const rowH = 34;
  const gap = 8;
  const labelW = 92;
  const h = data.length * (rowH + gap);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 480 ${h}`}
        width="100%"
        height={h}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMinYMin meet"
      >
        {data.map((d, i) => {
          const y = i * (rowH + gap);
          const w = Math.max(3, ((480 - labelW - 60) * d.value) / max);
          const fill = d.emphasis ? "var(--crown)" : "var(--accent)";
          return (
            <g
              key={d.label}
              onMouseEnter={() => setTip({ x: labelW + w, y: y + rowH / 2, label: `${d.label}: ${d.display}${unit ? " " + unit : ""}${d.sub ? " · " + d.sub : ""}` })}
              onMouseLeave={() => setTip(null)}
            >
              <text x={labelW - 10} y={y + rowH / 2} textAnchor="end" dominantBaseline="central" className="fill-muted font-mono text-[11px]">
                {d.label}
              </text>
              {/* track */}
              <rect x={labelW} y={y + 6} width={480 - labelW - 8} height={rowH - 12} rx={4} className="fill-[var(--surface-3)]" />
              {/* value bar, 4px rounded end anchored to the baseline */}
              <rect x={labelW} y={y + 6} width={w} height={rowH - 12} rx={4} fill={fill} opacity={d.emphasis ? 1 : 0.85} />
              <text x={labelW + w + 8} y={y + rowH / 2} dominantBaseline="central" className="fill-ink font-body text-[12px] tabular-nums">
                {d.display}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ----------------------------------------------------------------- line chart
export type Point = { label: string; value: number; display: string };

/** Single-series line: 2px stroke, ≥8px markers, a recessive baseline grid and
 *  a hover tooltip per point. */
export function LineChart({ data, ariaLabel }: { data: Point[]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 480;
  const H = 200;
  const padX = 16;
  const padY = 24;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = data.length;
  const x = (i: number) => (n <= 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1));
  const y = (v: number) => padY + (H - 2 * padY) * (1 - (v - min) / span);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const tip = hover !== null ? { x: x(hover), y: y(data[hover].value), label: `${data[hover].label}: ${data[hover].display}` } : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={ariaLabel} preserveAspectRatio="xMinYMin meet">
        {/* recessive baseline */}
        <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} className="stroke-[var(--border)]" strokeWidth={1} />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i ? (
              <line x1={x(i)} y1={padY} x2={x(i)} y2={H - padY} className="stroke-[var(--border-strong,#3a323c)]" strokeWidth={1} />
            ) : null}
            {/* fat invisible hit target */}
            <circle cx={x(i)} cy={y(d.value)} r={14} fill="transparent" />
            <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 6 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// --------------------------------------------------------- stacked outcome bar
export type Segment = { label: string; value: number; color: string };

/** Part-to-whole stacked bar for draw outcomes. Status colors, but every
 *  segment carries a direct label + count and a legend row, so identity never
 *  depends on color. 2px surface gaps between segments. */
export function OutcomeBar({ data, ariaLabel }: { data: Segment[]; ariaLabel: string }) {
  const total = Math.max(1, data.reduce((a, d) => a + d.value, 0));
  const present = data.filter((d) => d.value > 0);
  return (
    <div>
      <div
        className="flex h-9 w-full overflow-hidden rounded-md"
        role="img"
        aria-label={ariaLabel}
        style={{ gap: 2 }}
      >
        {present.map((d) => (
          <div
            key={d.label}
            className="flex items-center justify-center font-body text-[11px] font-bold text-[var(--bg)]"
            style={{ width: `${(d.value / total) * 100}%`, background: d.color, minWidth: 28 }}
            title={`${d.label}: ${d.value}`}
          >
            {d.value}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {data.map((d) => (
          <span key={d.label} className="inline-flex items-center gap-2 font-body text-xs text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} aria-hidden="true" />
            {d.label} <b className="text-ink tabular-nums">{d.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
