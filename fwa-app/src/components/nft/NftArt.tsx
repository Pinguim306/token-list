/**
 * Deterministic artwork for the demo NFTs.
 *
 * Known stock collections render a stylized company mark (Tesla's T, NVIDIA's
 * eye, SpaceX's swooping X) in brand colors over a faint generative pixel
 * field — the field is seeded by (symbol, tokenId), so every token keeps a
 * unique fingerprint behind its shared brand front. Unknown collections fall
 * back to the full-strength identicon look. Deterministic on purpose: the same
 * token always renders the same art, in RSC and client components alike, with
 * no network fetch. When a real collection with real tokenURIs arrives, this
 * component is the single place to swap.
 */

const GRID = 10; // cells per side; left half is generated, right half mirrored
const CELL = 12;
const SIZE = GRID * CELL;

type Palette = { bg: [string, string]; cells: string[] };

/** Per-collection look. Key = ERC-721 symbol; default covers unknown ones. */
const PALETTES: Record<string, Palette> = {
  TSLAon: {
    bg: ["#2a1a20", "#17120f"],
    cells: ["#e5647f", "#f0798f", "#f5eef1", "#e0a527"],
  },
  NVDAon: {
    bg: ["#10231a", "#17120f"],
    cells: ["#2ee27f", "#48d2f5", "#f5eef1", "#f7b750"],
  },
  SPCXD: {
    bg: ["#161c28", "#101319"],
    cells: ["#8fa4c0", "#c7d2e2", "#f5eef1", "#5a7dab"],
  },
  DEFAULT: {
    bg: ["#221d25", "#17120f"],
    cells: ["#786eff", "#f05adc", "#f5eef1", "#48d2f5"],
  },
};

/** Stylized brand marks (original simplified vectors, not official assets). */
function BrandMark({ symbol }: { symbol: string }) {
  switch (symbol) {
    case "TSLAon":
      return (
        <g data-brand="TSLAon">
          {/* Tesla-style T: curved wing + tapered stem */}
          <path
            d="M60 33 C46 25 32 23 18 26 L23 38 C34 35 45 36 54 41 L54 92 L66 92 L66 41 C75 36 86 35 97 38 L102 26 C88 23 74 25 60 33 Z"
            fill="#e82127"
          />
          <text x="60" y="108" textAnchor="middle" fontFamily="ui-sans-serif, sans-serif" fontSize="11" fontWeight="700" letterSpacing="4" fill="#f5eef1">
            TESLA
          </text>
        </g>
      );
    case "NVDAon":
      return (
        <g data-brand="NVDAon" fill="none" stroke="#76b900" strokeWidth="7" strokeLinecap="round">
          {/* NVIDIA-style eye: outer almond + inner swirl */}
          <path d="M84 60 C84 46 71 36 56 36 C42 36 28 45 18 60 C28 75 42 84 56 84 C71 84 84 74 84 60 Z" />
          <path d="M38 62 C38 53 46 47 56 48 C64 49 70 54 70 60" />
          <text x="60" y="108" textAnchor="middle" fontFamily="ui-sans-serif, sans-serif" fontSize="11" fontWeight="700" letterSpacing="3" fill="#f5eef1" stroke="none">
            NVIDIA
          </text>
        </g>
      );
    case "SPCXD":
      return (
        <g data-brand="SPCXD" fill="none" stroke="#d8dee6" strokeWidth="8" strokeLinecap="round">
          {/* SpaceX-style X: short backslash + long swooping stroke */}
          <path d="M34 40 L72 76" />
          <path d="M22 80 C46 72 76 52 104 30" />
          <text x="60" y="108" textAnchor="middle" fontFamily="ui-sans-serif, sans-serif" fontSize="11" fontWeight="700" letterSpacing="2.5" fill="#f5eef1" stroke="none">
            SPACEX
          </text>
        </g>
      );
    default:
      return null;
  }
}

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
  const branded = symbol in PALETTES && symbol !== "DEFAULT";
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
      {/* Per-token fingerprint: full-strength for unknown collections, a faint
          backdrop when a brand mark sits on top. */}
      <g opacity={branded ? 0.18 : 1}>
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
      </g>
      {branded ? <BrandMark symbol={symbol} /> : null}
    </svg>
  );
}
