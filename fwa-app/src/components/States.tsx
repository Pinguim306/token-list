"use client";

import type { DataSource } from "@/lib/indexer";

/** Shimmering placeholder. Width is a Tailwind class so callers can size rows. */
export function Skeleton({ className = "h-4 w-24" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-pulse rounded-md bg-surface-3 align-middle ${className}`}
    />
  );
}

export function SkeletonRows({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-border">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 px-5 py-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={c === 0 ? "h-4 w-10" : "h-4 w-20"} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A failed read. Distinct from empty on purpose: "nothing here" and "we could
 * not find out" are different facts, and collapsing them hides outages.
 */
export function ErrorNote({
  title = "Could not load",
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-5 py-4">
      <p className="m-0 font-body text-sm font-semibold text-ink">{title}</p>
      {detail ? <p className="m-0 mt-1 font-body text-xs text-muted">{detail}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 cursor-pointer rounded-pill border border-border-strong bg-surface px-4 py-1.5 font-body text-xs font-semibold text-ink"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 rounded-lg border border-border bg-surface-2 px-5 py-4 font-body text-sm text-muted">
      {children}
    </p>
  );
}

const SOURCE_LABEL: Record<DataSource, { text: string; title: string; tone: string }> = {
  demo: {
    text: "Sample data",
    title: "No pool configured — showing representative values",
    tone: "bg-accent-soft text-accent-strong",
  },
  indexer: {
    text: "Indexed",
    title: "Served from the Ponder indexer",
    tone: "bg-success-soft text-success",
  },
  rpc: {
    text: "Direct RPC",
    title: "Read from the pool contract directly — no indexer configured",
    tone: "bg-surface-3 text-muted",
  },
};

/** Says where the numbers came from, so a stale indexer is never mistaken for chain truth. */
export function SourceBadge({ source }: { source: DataSource }) {
  const s = SOURCE_LABEL[source];
  return (
    <span
      title={s.title}
      className={`rounded-pill px-2.5 py-1 font-body text-[10px] font-bold tracking-[0.1em] uppercase ${s.tone}`}
    >
      {s.text}
    </span>
  );
}
