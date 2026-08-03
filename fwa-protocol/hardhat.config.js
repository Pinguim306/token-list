require("@nomicfoundation/hardhat-toolbox");

/**
 * Hardhat configuration for the FWA protocol.
 *
 * PRIMARY TARGET: BNB Chain (BSC mainnet 56 / testnet 97) — EVM-compatible,
 * multi-validator (better randomness trust story than a single-sequencer L2),
 * native Chainlink VRF available, and home to tokenized stocks (xStocks et al),
 * which are the product's focus. The original RobinhoodChain networks are kept
 * for reference/portability — the contracts are chain-agnostic.
 *
 * BNB timing note: at ~0.75s blocks the 256-block blockhash window is ~3.2
 * minutes — the keeper must reveal promptly, and the pool's requestTimeout
 * should be tuned down (e.g. 15 min) via setParams after deploy.
 *
 * NOTE: Foundry is the toolchain recommended in the development plan, but its
 * binaries are distributed via GitHub Releases, which is blocked by this
 * environment's egress policy. Hardhat is used instead: its bundled network
 * needs no downloads and the solc compiler is fetched from
 * binaries.soliditylang.org, which is reachable. The contracts remain
 * framework-agnostic and can be compiled with Foundry elsewhere.
 */

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const accounts = MNEMONIC ? { mnemonic: MNEMONIC } : undefined;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // RobinhoodChain is Arbitrum Nitro; the default EVM target is fine.
      // Larger contracts are allowed (96 KB code-size limit vs 24 KB on L1).
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      // Simulate an L2 with a large block gas limit for local testing.
      blockGasLimit: 1_000_000_000,
      allowUnlimitedContractSize: true,
    },
    // ---- BNB Chain (primary target) ----
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://bsc-testnet.bnbchain.org",
      chainId: 97,
      accounts,
    },
    bsc: {
      url: process.env.BSC_RPC || "https://bsc-dataseed.bnbchain.org",
      chainId: 56,
      accounts,
    },
    // ---- RobinhoodChain (kept for portability) ----
    "robinhood-testnet": {
      url: process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts,
    },
    "robinhood-mainnet": {
      url: process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts,
    },
  },
  // Verification: BscScan for BNB Chain (built-in chain descriptors — the
  // network names bsc/bscTestnet match hardhat-verify's registry), Blockscout
  // for RobinhoodChain.
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      "robinhood-testnet": "blockscout",
      "robinhood-mainnet": "blockscout",
    },
    customChains: [
      {
        network: "robinhood-testnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com",
        },
      },
      {
        network: "robinhood-mainnet",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com",
        },
      },
    ],
  },
};
