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
      // HyperEVM is a standard EVM: EIP-170 applies, so deployed bytecode must
      // stay under 24 KB. `npm run size` guards it.
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      // Local runs are not gas-constrained; real deploys go into HyperEVM's
      // 30M-gas big blocks (see docs/deploy-runbook.md).
      blockGasLimit: 1_000_000_000,
      allowUnlimitedContractSize: true,
    },
    // ---- HyperEVM (primary target) ----
    hyperevmTestnet: {
      url: process.env.HYPEREVM_TESTNET_RPC || "https://rpc.hyperliquid-testnet.xyz/evm",
      chainId: 998,
      accounts,
    },
    hyperevm: {
      url: process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm",
      chainId: 999,
      accounts,
    },
    // ---- BNB Chain (kept for portability) ----
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
  // Verification: HyperEVM has no built-in hardhat-verify descriptor, so both
  // networks are declared as custom chains below. HyperEVMScan is the
  // Etherscan-family explorer; hyperscan.com (Blockscout) and Sourcify are
  // documented fallbacks in the runbook if an endpoint rejects the upload.
  etherscan: {
    apiKey: {
      hyperevm: process.env.HYPEREVMSCAN_API_KEY || "",
      hyperevmTestnet: process.env.HYPEREVMSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      "robinhood-testnet": "blockscout",
      "robinhood-mainnet": "blockscout",
    },
    customChains: [
      {
        network: "hyperevm",
        chainId: 999,
        urls: {
          apiURL: "https://api.hyperevmscan.io/api",
          browserURL: "https://hyperevmscan.io",
        },
      },
      {
        network: "hyperevmTestnet",
        chainId: 998,
        urls: {
          apiURL: "https://api-testnet.purrsec.com/api",
          browserURL: "https://testnet.purrsec.com",
        },
      },
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
