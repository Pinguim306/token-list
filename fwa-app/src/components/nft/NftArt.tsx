/**
 * Deterministic generative artwork for the demo NFTs.
 *
 * Each (collection symbol, tokenId) pair seeds a tiny PRNG that drives a
 * mirrored pixel grid over a two-tone gradient — the identicon/punk look.
 * Deterministic on purpose: the same token always renders the same art, in
 * RSC and client components alike, with no network fetch and nothing to
 * license. When a real collection with real tokenURIs arrives, this component
 * is the single place to swap.
 */

const GRID = 10; // cells per side; left half is generated, right half mirrored
const CELL = 12;
const SIZE = GRID * CELL;

type Palette = { bg: [string, string]; cells: string[] };

/** Per-collection look. Key = ERC-721 symbol; default covers unknown ones. */
const PALETTES: Record<string, Palette> = {
  TSLAB: {
    bg: ["#2a1a20", "#17120f"],
    cells: ["#e5647f", "#f0798f", "#f5eef1", "#e0a527"],
  },
  NVDAB: {
    bg: ["#10231a", "#17120f"],
    cells: ["#2ee27f", "#48d2f5", "#f5eef1", "#f7b750"],
  },
  DEFAULT: {
    bg: ["#221d25", "#17120f"],
    cells: ["#786eff", "#f05adc", "#f5eef1", "#48d2f5"],
  },
};

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Cell = { x: number; y: number; fill: string };

function generate(symbol: string, tokenId: string): { palette: Palette; cells: Cell[] } {
  const palette = PALETTES[symbol] ?? PALETTES.DEFAULT;
  const rand = mulberry32(hashSeed(`${symbol}:${tokenId}`));

  const cells: Cell[] = [];
  const half = GRID / 2;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < half; x++) {
      // Density peaks at the centre so the figure clusters instead of
      // scattering to the edges.
      const cx = (x + 0.5) / half; // 0..1 toward the mirror axis
      const cy = 1 - Math.abs((y + 0.5) / GRID - 0.5) * 2; // 1 at middle rows
      const p = 0.14 + 0.42 * cx * cy;
      if (rand() < p) {
        const fill = palette.cells[Math.floor(rand() * palette.cells.length)];
        cells.push({ x, y, fill });
        cells.push({ x: GRID - 1 - x, y, fill }); // mirror
      }
    }
  }
  return { palette, cells };
}

export function NftArt({
  symbol,
  tokenId,
  className,
}: {
  symbol: string;
  tokenId: string;
  className?: string;
}) {
  const { palette, cells } = generate(symbol, tokenId);
  // Gradient ids must be unique per instance or same-page SVGs cross-reference.
  const gid = `nftbg-${symbol}-${tokenId}`.replace(/[^a-zA-Z0-9-]/g, "");

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Generated artwork for ${symbol} #${tokenId}`}
      data-nft-art={`${symbol}-${tokenId}`}
      className={className}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.bg[0]} />
          <stop offset="100%" stopColor={palette.bg[1]} />
        </linearGradient>
      </defs>
      <rect width={SIZE} height={SIZE} fill={`url(#${gid})`} />
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x * CELL + 1}
          y={c.y * CELL + 1}
          width={CELL - 2}
          height={CELL - 2}
          rx={2.5}
          fill={c.fill}
        />
      ))}
    </svg>
  );
}
