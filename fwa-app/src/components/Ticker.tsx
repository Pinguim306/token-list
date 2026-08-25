const ITEMS = [
  "Tokenized stock packs",
  "Freeze-at-request",
  "Keeper × blockhash · Entropy-upgradable",
  "Inverse-weight odds",
  "Crown tithe",
  "Pull-based payouts",
  "Sell-back standing bid",
];

export function Ticker() {
  const seq = [...ITEMS, ...ITEMS];
  return (
    <div className="ticker" aria-hidden="true">
      <div className="track">
        {seq.map((t, i) => (
          <span className="chip" key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}
