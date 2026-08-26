/**
 * HyperCore-linked tokenized stocks ("dStocks") deliverable by PackRip's
 * take-the-shares settlement — GENERATED from on-chain verification
 * (fwa-protocol/scripts/data/dstocks-hyperevm.json; see
 * docs/tokenized-stocks-hyperevm.md). Each entry is an ERC-20 on HyperEVM
 * (chain 999) EVM-linked to a HyperCore spot orderbook, so the checkout can
 * price it live through the spotPx/BBO precompiles and the treasury can
 * replenish inventory on the Core book.
 *
 * `active` = the Core book was healthy when measured (spread < 2% with real
 * volume) and the stock is in the launch draw pool + on-chain allowlist.
 * `priceUsd` is the live Core price at generation time — display/rarity only,
 * settlement always reads the live price on-chain.
 */
export type Dstock = {
  ticker: string;
  symbol: string;
  name: string;
  address: `0x${string}`;
  spotPairIndex: number;
  pxScale: number;
  active: boolean;
  priceUsd?: number;
};

export const DSTOCK_CATALOG: readonly Dstock[] = [
  {
    "ticker": "AAPL",
    "symbol": "AAPLd",
    "name": "Apple (dStock)",
    "address": "0x7374DC1894fBD1bc6C42f6Ebbc50b78C211A8606",
    "spotPairIndex": 268,
    "pxScale": 1000000,
    "active": false
  },
  {
    "ticker": "AMZN",
    "symbol": "AMZNd",
    "name": "Amazon (dStock)",
    "address": "0x4F2164C12D2d450A8B1D430492Ef6670FE4caD8e",
    "spotPairIndex": 280,
    "pxScale": 10000,
    "active": false
  },
  {
    "ticker": "CRCL",
    "symbol": "CRCLd",
    "name": "Circle Internet Group (dStock)",
    "address": "0xe74aA6C4050A15790525eB11cc4562c664dC67C9",
    "spotPairIndex": 263,
    "pxScale": 1000000,
    "active": true,
    "priceUsd": 91.77
  },
  {
    "ticker": "GLD",
    "symbol": "GLDd",
    "name": "SPDR Gold Shares (dStock)",
    "address": "0x08be08c37D93E689518CED744A89F113b4AfAad4",
    "spotPairIndex": 276,
    "pxScale": 10000,
    "active": true,
    "priceUsd": 418.92
  },
  {
    "ticker": "GOOGL",
    "symbol": "GOOGLd",
    "name": "Alphabet Class A (dStock)",
    "address": "0x35eEdA03E55FF217a013892E9e2E37E792B264EA",
    "spotPairIndex": 266,
    "pxScale": 1000000,
    "active": false
  },
  {
    "ticker": "HOOD",
    "symbol": "HOODd",
    "name": "Robinhood Markets (dStock)",
    "address": "0xc304a9d52CF9165024EBc7814250EF3A5013F924",
    "spotPairIndex": 271,
    "pxScale": 10000,
    "active": true,
    "priceUsd": 112.18
  },
  {
    "ticker": "META",
    "symbol": "METAd",
    "name": "Meta Platforms (dStock)",
    "address": "0x5A9D2DeeE7D8782011695623f1C453F46B2b566e",
    "spotPairIndex": 287,
    "pxScale": 10000,
    "active": true,
    "priceUsd": 562.22
  },
  {
    "ticker": "MSFT",
    "symbol": "MSFTd",
    "name": "Microsoft (dStock)",
    "address": "0x66520d8Fd614487214a25Af7bAbF27584f59f76B",
    "spotPairIndex": 289,
    "pxScale": 10000,
    "active": false
  },
  {
    "ticker": "MU",
    "symbol": "MUd",
    "name": "Micron Technology (dStock)",
    "address": "0x173C83A71C1A9E254721A86B7512cD65bf92648d",
    "spotPairIndex": 333,
    "pxScale": 10000,
    "active": true,
    "priceUsd": 935.74
  },
  {
    "ticker": "ORCL",
    "symbol": "ORCLd",
    "name": "Oracle (dStock)",
    "address": "0xCA2156522638f597FFb3705857fFdC356EFABe50",
    "spotPairIndex": 331,
    "pxScale": 10000,
    "active": false
  },
  {
    "ticker": "QQQ",
    "symbol": "QQQd",
    "name": "Invesco QQQ (dStock)",
    "address": "0x499e347174f237AD28687B947B94C0d49570D1b7",
    "spotPairIndex": 288,
    "pxScale": 10000,
    "active": true,
    "priceUsd": 718.73
  },
  {
    "ticker": "SLV",
    "symbol": "SLVd",
    "name": "iShares Silver Trust (dStock)",
    "address": "0x7EF4Eba0C0200957e357627CEd1884D6CB63E961",
    "spotPairIndex": 265,
    "pxScale": 1000000,
    "active": true,
    "priceUsd": 62.58
  },
  {
    "ticker": "SPCX",
    "symbol": "SPCXd",
    "name": "SpaceX (dStock)",
    "address": "0xe8c8AFDf7E80bE51E91AFA28B6aC44404d270B5d",
    "spotPairIndex": 590,
    "pxScale": 10000,
    "active": false,
    "priceUsd": 124.39
  },
  {
    "ticker": "SPY",
    "symbol": "SPYd",
    "name": "SPDR S&P 500 ETF (dStock)",
    "address": "0xB7bF37783DB41A2851B77c6917280c56312C833a",
    "spotPairIndex": 279,
    "pxScale": 10000,
    "active": true,
    "priceUsd": 773.32
  }
] as const;

export const ACTIVE_DSTOCKS: readonly Dstock[] = DSTOCK_CATALOG.filter((d) => d.active);

export function dstockByAddress(address: string | undefined): Dstock | undefined {
  if (!address) return undefined;
  const a = address.toLowerCase();
  return DSTOCK_CATALOG.find((d) => d.address.toLowerCase() === a);
}
