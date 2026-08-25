require("@nomicfoundation/hardhat-toolbox");

/**
 * Hardhat configuration for the FWA protocol.
 *
 * PRIMARY TARGET: HyperEVM (mainnet 999 / testnet 998) — standard EVM under
 * HyperBFT, home to deep tokenized-stock supply (Ondo, Dinari), which is the
 * product's focus. No Chainlink VRF exists on this chain: the keeper adapter
 * is the launch randomness path and Pyth Entropy is the verifiable upgrade.
 * The BNB Chain and RobinhoodChain networks are kept for portability — the
 * contracts are chain-agnostic.
 *
 * HyperEVM timing note: at ~1s small blocks the 256-block blockhash window is
 * ~4 minutes — the keeper must reveal promptly, and the pool's requestTimeout
 * should be tuned down (e.g. 10 min) via setParams after deploy. Deploys must
 * go through big blocks (see docs/deploy-runbook.md).
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
  // Verification. The apiKey MUST stay a plain string: that switches
  // hardhat-verify 2.x into Etherscan V2 mode, where every request goes to
  // api.etherscan.io/v2/api with a chainid parameter the plugin appends itself
  // (999 is listed in Etherscan's /v2/chainlist). The object form silently
  // selects V1 mode, which clobbers an apiURL-embedded ?chainid= on the
  // status-poll GETs — the upload succeeds and the poll then always errors.
  // Testnet (998) is NOT covered by Etherscan V2; both 999 and 998 ARE
  // supported by Sourcify — but NOT through this plugin: Sourcify sunset its
  // v1 API and hardhat-verify 2.x still posts to the removed endpoints
  // ("Cannot POST /verify"). Verify on Sourcify with the v2-API script
  // instead:  node scripts/sourcify-verify.js <chainId> <addr>=<fqn> ...
  // (confirmed working against the live FWA deployment on chain 999).
  // The legacy robinhood-* networks keep RPC access but no verify wiring.
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "hyperevm",
        chainId: 999,
        urls: {
          // In V2 mode the plugin routes through the unified host; this entry
          // exists so hardhat-verify recognizes the chain and links the site.
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://hyperevmscan.io",
        },
      },
    ],
  },
  sourcify: {
    // Disabled: the plugin's Sourcify integration targets the sunset v1 API
    // and always fails against today's sourcify.dev. Use
    // scripts/sourcify-verify.js (v2 API) — the only verification route for
    // testnet (998) and a no-API-key route for mainnet (999).
    enabled: false,
  },
};
