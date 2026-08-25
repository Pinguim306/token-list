# FWA App — HyperEVM frontend

Next.js 15 (App Router) + wagmi v2 + viem dashboard for the Fake World Assets
protocol on HyperEVM.

## Features
- Connect via EIP-6963 injected-wallet discovery (MetaMask, Rabby, OKX, …).
- **Pool stats** — live acquisition price, active positions, surcharge/bid, crown holder & tithe pot, draw state.
- **Positions** — every active position with its on-chain **win odds** (inverse to backing) — the transparency the gacha framing demands.
- **Deposit** — approve NFT + backing, then create a position.
- **Draw** — start a draw, watch the freeze-at-request lifecycle (Requested → Fulfilled), settle Keep/Sell-back, finalize, or expire for a refund.
- **Credits** — pull-based withdrawals of earnings, refunds, sell-back proceeds, and crown tithes.
- **$FWA rewards** — depositor emissions + pro-rata daily-pot purchaser claims.

## Run
```bash
npm install
cp .env.local.example .env.local   # set the deployed addresses + NEXT_PUBLIC_CHAIN
npm run dev                        # http://localhost:3000
npm run build                      # production build (type-checked)
```

Chains are hand-defined for HyperEVM mainnet (999) and testnet (998) in
`src/lib/chains.ts`; addresses come from `NEXT_PUBLIC_*` env vars. ABIs in
`src/lib/abis.ts` are extracted from the compiled `fwa-protocol` artifacts.

> Note: we rely on EIP-6963 discovery rather than statically importing
> `wagmi/connectors`, because that barrel pulls in the Coinbase Base Account
> connector and its heavy optional payment deps.
