// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRandomnessAdapter, IRandomnessRouter} from "../interfaces/IRandomness.sol";

/// @title KeeperHashChainAdapter
/// @notice Native randomness backend: a keeper commit-reveal hash chain mixed with
///         a future blockhash. This is the scheme StockRip runs in production on
///         Robinhood Chain — it needs no external oracle (no Chainlink VRF/CCIP,
///         no Pyth), so it satisfies the G0 randomness gate with nothing but a
///         funded keeper.
///
/// @dev How the entropy is built, per request:
///
///        1. Off-chain, the keeper generates a hash chain c_0, c_1 = H(c_0), ...,
///           c_n = H(c_{n-1}) and commits only the head c_n via `commitHead`.
///           Every link is therefore fixed *before* any draw exists.
///        2. `requestRandomness` pins a future seed block:
///           `seedBlock = block.number + SEED_DELAY`. Nobody — keeper included —
///           knows `blockhash(seedBlock)` yet.
///        3. Once the seed block is history, the keeper calls `reveal(preimage)`
///           where `keccak256(preimage) == chainHead`. The word is
///           `keccak256(preimage, keccak256(requestId, blockhash(seedBlock)), requestId)`
///           and the head walks backward: `chainHead = preimage`.
///
///      Neither party alone controls the outcome: the keeper fixed its
///      contribution at commit time (a different preimage simply does not hash
///      to the head), and the block producer does not know the unrevealed
///      preimage when it seals the seed block.
///
///      TRUST MODEL (documented, not hidden): on HyperEVM `block.number` and
///      `blockhash` come from HyperBFT block production, so a keeper colluding
///      with a block producer could grind outcomes. This is weaker than a VRF
///      and is accepted as launch-grade because the pool bounds the damage (one
///      serialized draw at a time, price escrowed, expireDraw refunds) and the
///      keeper can post a slashable bond. The router indirection means a
///      verifiable adapter (Pyth Entropy, which is live on HyperEVM) can
///      replace this one with zero pool changes.
///
///      Liveness: exactly one request may be pending (the pool serializes draws
///      anyway). If the keeper goes silent past the ~256-block blockhash window
///      the request is unservable — anyone may `skipStale` to unblock the
///      adapter (recording a slashable incident), and the pool refunds the
///      buyer via its own `expireDraw` timeout. NOTE the mismatch on HyperEVM:
///      256 blocks at ~1s of small-block cadence is only ~4 minutes, far inside
///      the pool's 1 h default request timeout — so a buyer would wait an hour
///      for a refund on a failure that was already terminal after four minutes.
///      Set `requestTimeout` to ~10 min at deploy (see docs/deploy-runbook.md).
contract KeeperHashChainAdapter is IRandomnessAdapter, Ownable {
    /// @dev Seed block distance, matching StockRip's production parameter.
    uint256 public constant SEED_DELAY = 5;
    /// @dev `blockhash` only resolves for the most recent 256 blocks.
    uint256 public constant BLOCKHASH_WINDOW = 256;

    address public immutable router;
    address public keeper;

    /// @notice Current head of the keeper's hash chain (0 = no chain committed).
    bytes32 public chainHead;
    /// @notice Reveals still available on the committed chain (keeper-declared).
    uint256 public revealsRemaining;

    /// @notice The single in-flight router request id (0 = none).
    uint256 public pendingRequestId;
    /// @notice Block whose hash seeds the pending request.
    uint256 public seedBlock;

    /// @notice ETH bond posted by the keeper, slashable after stale skips.
    uint256 public bond;
    /// @notice Stale skips not yet answered by a slash (or forgiven by one).
    uint256 public slashableSkips;

    event HeadCommitted(bytes32 indexed head, uint256 reveals);
    event RandomnessRequested(uint256 indexed routerRequestId, uint256 seedBlock);
    event Revealed(uint256 indexed routerRequestId, uint256 randomWord);
    event StaleSkipped(uint256 indexed routerRequestId);
    event KeeperUpdated(address indexed keeper);
    event BondPosted(address indexed keeper, uint256 amount, uint256 total);
    event BondWithdrawn(address indexed keeper, uint256 amount, uint256 total);
    event Slashed(address indexed to, uint256 amount, uint256 remainingBond);

    modifier onlyKeeper() {
        require(msg.sender == keeper, "KHC: not keeper");
        _;
    }

    constructor(address router_, address keeper_, address initialOwner) Ownable(initialOwner) {
        require(router_ != address(0) && keeper_ != address(0), "KHC: zero");
        router = router_;
        keeper = keeper_;
    }

    // --------------------------------------------------------------------- //
    //                              Hash chain                               //
    // --------------------------------------------------------------------- //

    /// @notice Commit a fresh hash-chain head. Blocked while a request is
    ///         pending — rotating the head then would orphan the in-flight
    ///         reveal. `reveals` is the keeper-declared chain length used to
    ///         fail `requestRandomness` loudly when the chain runs dry
    ///         (a draw that can never be revealed would otherwise sit until
    ///         the pool's expireDraw refund).
    function commitHead(bytes32 newHead, uint256 reveals) external onlyKeeper {
        require(pendingRequestId == 0, "KHC: pending");
        require(newHead != bytes32(0) && reveals > 0, "KHC: empty chain");
        chainHead = newHead;
        revealsRemaining = reveals;
        emit HeadCommitted(newHead, reveals);
    }

    // --------------------------------------------------------------------- //
    //                            Request / reveal                           //
    // --------------------------------------------------------------------- //

    /// @inheritdoc IRandomnessAdapter
    function requestRandomness(uint256 routerRequestId) external returns (bytes32) {
        require(msg.sender == router, "KHC: only router");
        require(pendingRequestId == 0, "KHC: pending");
        require(revealsRemaining > 0, "KHC: chain exhausted");
        pendingRequestId = routerRequestId;
        seedBlock = block.number + SEED_DELAY;
        emit RandomnessRequested(routerRequestId, seedBlock);
        return bytes32(routerRequestId);
    }

    /// @notice Keeper reveals the next chain link once the seed block is
    ///         history, delivering the mixed word through the router. The
    ///         router's consumer callback is store-only and never reverts, so
    ///         a stale/expired pool draw cannot brick the reveal.
    function reveal(bytes32 preimage) external onlyKeeper {
        uint256 requestId = pendingRequestId;
        require(requestId != 0, "KHC: no pending");
        require(block.number > seedBlock, "KHC: too early");
        require(block.number <= seedBlock + BLOCKHASH_WINDOW, "KHC: stale seed");
        require(keccak256(abi.encodePacked(preimage)) == chainHead, "KHC: bad preimage");

        bytes32 bh = blockhash(seedBlock);
        require(bh != bytes32(0), "KHC: no blockhash");

        // Effects before the router interaction: walk the head, burn a reveal,
        // clear the pending slot.
        chainHead = preimage;
        revealsRemaining -= 1;
        pendingRequestId = 0;
        seedBlock = 0;

        uint256 word = uint256(
            keccak256(abi.encodePacked(preimage, keccak256(abi.encodePacked(requestId, bh)), requestId))
        );
        emit Revealed(requestId, word);
        IRandomnessRouter(router).fulfill(requestId, word);
    }

    /// @notice Permissionless liveness valve: once the seed block has aged out
    ///         of the blockhash window the pending request is unservable —
    ///         clear it so the adapter can serve the next draw, and record a
    ///         slashable incident against the keeper. The chain head is NOT
    ///         consumed. The buyer's refund is the pool's own expireDraw.
    function skipStale() external {
        uint256 requestId = pendingRequestId;
        require(requestId != 0, "KHC: no pending");
        require(block.number > seedBlock + BLOCKHASH_WINDOW, "KHC: not stale");
        pendingRequestId = 0;
        seedBlock = 0;
        slashableSkips += 1;
        emit StaleSkipped(requestId);
    }

    // --------------------------------------------------------------------- //
    //                              Keeper bond                              //
    // --------------------------------------------------------------------- //

    /// @notice Keeper posts ETH collateral against liveness failures.
    function postBond() external payable onlyKeeper {
        require(msg.value > 0, "KHC: zero bond");
        bond += msg.value;
        emit BondPosted(msg.sender, msg.value, bond);
    }

    /// @notice Keeper reclaims bond — only when nothing is pending and no
    ///         stale skip awaits judgment.
    function withdrawBond(uint256 amount) external onlyKeeper {
        require(pendingRequestId == 0, "KHC: pending");
        require(slashableSkips == 0, "KHC: slashable skip");
        require(amount <= bond, "KHC: exceeds bond");
        bond -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "KHC: transfer failed");
        emit BondWithdrawn(msg.sender, amount, bond);
    }

    /// @notice Owner answers one recorded stale skip by slashing up to the
    ///         full bond to a recipient (e.g. compensating the refunded buyer).
    ///         Passing amount 0 forgives the incident without payment.
    function slash(address payable to, uint256 amount) external onlyOwner {
        require(slashableSkips > 0, "KHC: nothing slashable");
        require(to != address(0), "KHC: zero");
        slashableSkips -= 1;
        if (amount > bond) amount = bond;
        bond -= amount;
        if (amount > 0) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "KHC: transfer failed");
        }
        emit Slashed(to, amount, bond);
    }

    /// @notice Rotate the keeper. Requires the bond to be fully withdrawn or
    ///         slashed first so a rotation can never hand one keeper's
    ///         collateral to another.
    function setKeeper(address newKeeper) external onlyOwner {
        require(newKeeper != address(0), "KHC: zero");
        require(pendingRequestId == 0, "KHC: pending");
        require(bond == 0, "KHC: bond posted");
        keeper = newKeeper;
        emit KeeperUpdated(newKeeper);
    }
}
