# Fase 0 — G0 gate findings (live probe)

> **Method:** probed the **live RobinhoodChain testnet** (`chainId 46630`,
> `rpc.testnet.chain.robinhood.com`) with `fwa-protocol/scripts/probe-chain.js`,
> plus the official docs. Date of probe: 2026-07-24.
> **Status: G0 PARTIALLY VALIDATED — not yet closable.** The chain-capability
> checks pass; the randomness round-trip and provider-availability checks remain
> open and need a funded deployer + provider addresses.

## Confirmed on-chain (evidence)

| Check | Result | Verdict |
|---|---|---|
| Testnet reachable | `eth_chainId` → `0xb626` (46630) | ✅ |
| Mainnet reachable | `eth_chainId` → `0x1237` (4663) | ✅ |
| **ArbOS version** | **116** | ✅ **Cancun + Shanghai opcodes supported** (`mcopy`/`tstore`/`push0`) — the conservative `paris` + OZ 5.0.x pin is safe, and upgrading to Cancun/OZ 5.1 is now proven available |
| `ArbSys` precompile (`0x64`) | `arbBlockNumber()` = `arbOSVersion()` responsive | ✅ use `ArbSys.arbBlockNumber()` for L2 block windows |
| `ArbGasInfo` precompile (`0x6C`) | present | ✅ two-part gas accounting available |
| Multicall3 (`0xcA11…CA11`) | PRESENT (3808 bytes) | ✅ good for indexing/frontend batching |
| Permit2 (`0x0000…78BA3`, per RH docs) | PRESENT (9152 bytes) | ✅ gasless-approval UX available |
| Gas price | ~0.01 gwei on testnet | ✅ cheap |

The official `docs.robinhood.com/chain/protocol-contracts` page documents the
Arbitrum core/bridge/gateway infra and the precompiles, but **does not publish
Chainlink CCIP, Data Feeds, LINK, Uniswap, or USDG addresses.**

## Open items (block closing G0)

| # | Item | Why it blocks | How to close |
|---|---|---|---|
| 1 | **CCIP↔VRF round-trip cost/latency** | The whole randomness design rests on it; unmeasured | Deploy `CCIPVRFAdapter` (RH testnet) + `VRFRequester` (Arbitrum Sepolia), fund a deployer + a VRF subscription + LINK/ETH, fire ≥20 draws, measure p50/p95 latency and per-draw cost. **Needs a funded key + Chainlink subscription — cannot be done autonomously here.** Tooling is ready: `fwa-protocol/scripts/spike-randomness.js` fires N draws, measures p50/p95 latency and per-draw request cost, self-heals a hung draw via `expireDraw`, and writes a JSON report. |
| 2 | **Chainlink CCIP Router address on RH Chain** | Needed to wire the adapter | Not in RH docs (and the Chainlink `ccip/directory/.../robinhood` URL 404'd). Obtain from Chainlink's CCIP directory / RH partner docs, then re-run the probe to confirm bytecode. |
| 3 | **Pyth Entropy availability (fallback randomness)** | The target native fallback | Pyth Entropy contract-addresses page did not list chainId 4663/46630 (404 on the probed URL). Confirm on Pyth's chainlist; if absent, open onboarding with Pyth. |
| 4 | **Uniswap v4 PoolManager presence** | Gates the `$FWA` fee-hook design (we already fell back to a native ERC-20 fee, so this is now non-blocking but worth confirming) | Find the address on Blockscout and probe. |
| 5 | **Mainnet ToS** (anti-gambling / dApp clauses) | Product/legal, per the viability study | Read the current mainnet ToS. |
| 6 | **NFT collection floors** | Prize-backing viability | Check native RH collections on OpenSea; confirm the USDG/ETH "vault" pivot. |

## G0 go/no-go recommendation

The **chain is a clean EVM deployment target** and the opcode/precompile/tooling
risks are now cleared. The **decision-critical unknown is item #1** (VRF-via-CCIP
economics) together with #2/#3 (whether any verifiable randomness provider is
actually reachable on RH Chain today). Until a funded testnet spike measures the
round-trip and a provider address is confirmed, **G0 stays open** and further
investment beyond the already-built, framework-agnostic contracts should be
gated. Everything built so far (Fase 1 core + Fase 2 tokenomics) is independent
of that outcome and deployable the moment a randomness adapter is confirmed.

*Reproduce:* `cd fwa-protocol && npx hardhat run scripts/probe-chain.js --network robinhood-testnet`
