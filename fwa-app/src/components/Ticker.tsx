const ITEMS = [
  "Freeze-at-request",
  "VRF over CCIP",
  "Inverse-weight odds",
  "Crown tithe",
  "Pull-based payouts",
  "Daily-pot $FWA rewards",
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
