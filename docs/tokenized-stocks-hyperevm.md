# Tokenized stocks on HyperEVM — validated catalog (2026-08-26)

The candidate pool for FWA packs: every tokenized stock/ETF found live on
HyperEVM mainnet (999), with the on-chain validation each address passed.
This fills the runbook's "resolve from the issuer and verify on the explorer"
gate with concrete, checked addresses.

## How these were validated (all checks on-chain, chain 999)

- **Discovery**: CoinGecko platform listings (`hyperevm`), cross-referenced
  with the issuers' announced rollouts (Ondo × LayerZero: 35 assets; Dinari
  dShares native on HyperEVM).
- **Every address**: bytecode present; `symbol()`, `name()`, `decimals()`
  read on-chain and matched against the issuer's naming pattern
  (`… (Ondo Tokenized …)` / full legal security names for Dinari). All 18
  decimals.
- **Set consistency (strong signal)**: all 35 Ondo tokens share **one
  identical bytecode hash** (`0xb924bf8b…`), and all 18 Dinari tokens share
  **one identical bytecode hash** (`0xcc62cfc6…`) — each set was deployed by
  a single factory/entity; a spoofed address would stick out immediately.
- Ondo's LayerZero wiring uses the adapter pattern (the token itself exposes
  no `endpoint()`/`peers()`), same as their BSC deployment — the official
  LayerZero EID for HyperEVM is 30367, endpoint V2
  `0x3A73033C0b1407574C76BdBAc67f126f6b4a9AA9` (from LayerZero's metadata
  API), kept here for future adapter-level verification.

> Final gate before `EquityBasket.setTokenAllowed`: open each address on
> [hyperevmscan.io](https://hyperevmscan.io) and confirm holders/activity
> look organic. Curation is the owner's responsibility.

## Ondo (bridged OFTs — 35 assets, symbol suffix "on")

| Symbol | Name | Address |
|---|---|---|
| TSLAon | Tesla | `0x417883b1709545f1211A25b00ad13455fC7F1bc5`* |
| NVDAon | NVIDIA | `0xB989ad9b91886b1Aaed8DaADb26F028b29b40945`* |
| AAPLon | Apple | `0x81db0DF77669b3BE563e7a0591685a2C8C3EE1c5`* |
| MSFTon | Microsoft | `0xD53471f6D493f7eD766181D88Ba9c2Bfc371399A`* |
| METAon | Meta Platforms | `0x46FA18Ffe2707bbecc46D457D40EFBE6B932f711`* |
| GOOGLon | Alphabet A | `0x4D34798f18Eb747F7225663F0553eA2D880cf75D`* |
| AMZNon | Amazon | `0xeD68F063264a01fd7f93087DC19CC1E0D614e8De`* |
| NFLXon | Netflix | `0x81Ebb420a81855f1Bf1B0fF95eCa9d3Bd736ea89`* |
| HOODon | Robinhood Markets | `0xF1Df92AC8E22763A16bf4Bd9a966EEBcD70fA5a3`* |
| PLTRon | Palantir | `0x039358AB6919159f6026Ea4428595a5AaF12A35C`* |
| MSTRon | MicroStrategy | `0x8a64FDf0857c1C734A594cd1DB20B3f8E3f133f6`* |
| COINon | Coinbase | `0x639Bcd00422facAcA534063e3d860e8fcf78B46F`* |
| CRCLon | Circle | `0x13a81c5e8b4AB05Fc721DfF7bA95e250b29458F8`* |
| AMDon | AMD | `0x33706203A7a7c82B6F6c09dd9Ae4E6e881d36386`* |
| ORCLon | Oracle | `0x4775e99a13651B1D077c2fa04Eb9BF007f684af5`* |
| INTCon | Intel | `0x7bf529bb5Db370D679F33f4fe5420F48eE234bB7`* |
| TSMon | TSMC | `0x3254cdffDDEDdb1F61B9eF6f67e178615CCb0E85`* |
| BABAon | Alibaba | `0x799Bf997B733CAb2e1377D0411b63E35133991eb`* |
| RIVNon | Rivian | `0x353D347bb7bc1C812E3a131d9b5193b3618029e5`* |
| CRWVon | CoreWeave | `0xd616dDC3a9e13e12533d7124d5BD94B53Fb60A3f`* |
| SNDKon | SanDisk | `0xB8927cfF399E23328eEC0e457e75c709DCfcF382`* |
| MUon | Micron | `0x0f8E33F5CdefAE9C2E59de8fB61feD347046D046`* |
| FCXon | Freeport-McMoRan | `0xA019295D44677dd2f5B066245453938B1b1C483B`* |
| SPYon | SPDR S&P 500 ETF | `0x32eC2792aeC02122eDD9f28866B720db1e1c1B54`* |
| QQQon | Invesco QQQ ETF | `0x911e2dCD2b70F44231F3F0f1C6ec9aF75068FD85`* |
| IVVon | iShares Core S&P 500 | `0xAd26B6048cc3682f67Fe4C829b7Ac99dbF95920e`* |
| GLDon | SPDR Gold Shares | `0x95FebDd6f447B5278c9b98743B4254eB02c6EA1d`* |
| SLVon | iShares Silver Trust | `0xd53d98d13D93C817011645442c2e4d46E499B460`* |
| IAUon | iShares Gold Trust | `0x83b01AC9e2D1632A70Dd1C813c5B8eDF29cd707f`* |
| EWYon | iShares MSCI South Korea | `0xed871e0D99369AB869Fc38255a284361A137746B`* |
| COPXon | Global X Copper Miners | `0x86E33197369a3560CeE2Ab6Bb12376AC7b29f3dD`* |
| PALLon | abrdn Physical Palladium | `0x5Ff6E08A0Bdbc1ff11004FfB62B7aC7CdCf101Bd`* |
| PPLTon | abrdn Physical Platinum | `0xB4C0eaf28Ae7f667D9dabAA995F7A6E75e094770`* |
| UNGon | US Natural Gas Fund | `0x2c81466C9B144E3B6e9D6e8858Bc0973a953Fb0A`* |
| USOon | United States Oil Fund | `0xA4dB50bB345151f3649539300523e83a8b8A6BC7`* |

\* Addresses are checksummed from lowercase discovery data — byte-for-byte
identical on-chain (EVM addresses are case-insensitive; the checksum is
display-only). Bytecode hash `0xb924bf8b…` on every row.

## Dinari dShares (native — 18 assets, incl. SpaceX)

| Symbol | Name | Address |
|---|---|---|
| **SPCX** | **Space Exploration Technologies (SpaceX)** | `0x9b4Db2271EB1fa0aEe1abA7ed55E51C38cE514a3` |
| TSLA | Tesla | `0x4193C2B9B176763f48B1eF5266aEd71f6348ba81` |
| NVDA | NVIDIA | `0x4B16f5251cd4c853f28998809DcA61ccCBcB898B` |
| AAPL | Apple | `0xB6b0149009eb78239213b97A960b5c793C03373b` |
| MSFT | Microsoft | `0x1831FdAC7Fcb9271f2E2FfB1bbba965CcAf8136B` |
| META | Meta Platforms | `0x5183EfaBdDA4F872788307B705163982036ba962` |
| GOOGL | Alphabet A | `0x7024f993A0781169E064346396c5F6139DC6d98A` |
| AMZN | Amazon | `0xAbA4a08C36404f6EFf79Dc85b0b4c5172A095504` |
| DIS | Walt Disney | `0x7F7A731e180F7Dd4497c751afcee4F4009d9C046` |
| AGRO | Adecoagro | `0xf70ebb75cb588798B742ba0ff50db8F200e724D9` |
| SPY | SPDR S&P 500 ETF | `0x82E9e5725dA9050e121D12802fCC302752aBaA1A` |
| QQQ | Invesco QQQ | `0xD1234e7Dc6c710E9F95C4eEC5f90907D0db2DAF1` |
| GLD | SPDR Gold Trust | `0xE7E6c5d49Ab25913D7352d600eED3c85525C8894` |
| SLV | iShares Silver Trust | `0x73AAf1C699B189b24c7E4D7F06bbE6647DE1e9e0` |
| USO | US Oil Fund | `0xa79e5fD378f0F70fbfdbC1306A652a25d82772D3` |
| FBND | Fidelity Total Bond ETF | `0x2C5c46fCe70E366f8255ed2725b7F988b8433aec` |
| CLOA | iShares AAA CLO Active ETF | `0x5FA77434c3d3664a66b121C26e06D54Db61611CA` |
| KDEF | PLUS Korea Defense ETF | `0xfd14A7869ed12Eb5C46D336DD23565d3af2b5551` |

Bytecode hash `0xcc62cfc6…` on every row. Names read on-chain are the full
legal security names (e.g. "Space Exploration Technologies Corp.").

## Suggested pack curation

The product identity today is **Tesla / NVIDIA / SpaceX**:

- **Tesla** → Ondo `TSLAon` or Dinari `TSLA`
- **NVIDIA** → Ondo `NVDAon` or Dinari `NVDA`
- **SpaceX** → Dinari `SPCX` (native ERC-20 on 999 — the HyperCore-spot
  caveat from the deploy runbook is RESOLVED: it exists as an ERC-20)

Recommended expansion set (recognizable, meme-friendly, on-brand):
`AAPL`, `MSFT`, `META`, `GOOGL`, `AMZN`, `HOODon` (Robinhood — thematic),
`PLTRon`, `MSTRon`, `COINon`, and an "index pack" tier with `SPY`/`QQQ`/`GLD`.

Liquidity note: none of these had HyperEVM DEX pools at validation time —
they are bridge/mint-and-hold assets. Pack payouts deliver the tokens
themselves (the basket unwraps them), so DEX liquidity is not required for
the pack mechanics; it only matters if FWA later wants on-chain NAV pricing.
