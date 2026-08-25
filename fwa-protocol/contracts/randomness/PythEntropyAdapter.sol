// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRandomnessAdapter, IRandomnessRouter} from "../interfaces/IRandomness.sol";

/// @dev Minimal local mirror of the Pyth Entropy surface — same convention as
///      IVRFCoordinatorV25Like in VRFDirectAdapter: no external package
///      dependency here; swap in the official entropy-sdk-solidity package's
///      IEntropy/IEntropyConsumer before mainnet.
interface IEntropyLike {
    function getFee(address provider) external view returns (uint128 feeAmount);

    function requestWithCallback(address provider, bytes32 userRandomNumber)
        external
        payable
        returns (uint64 assignedSequenceNumber);
}

/// @title PythEntropyAdapter
/// @notice Pyth Entropy randomness for the RandomnessRouter — the verifiable
///         path on HyperEVM, where Chainlink ships no VRF coordinator.
///
/// @dev Trust upgrade over KeeperHashChainAdapter: Entropy is a two-party
///      commit-reveal. The provider pre-commits a hash chain of random values;
///      each request binds one committed value to a user contribution supplied
///      here, and the delivered word hashes both together — so neither the
///      provider nor the requester alone can steer an outcome, and (unlike the
///      keeper path) the block producer has no grinding lever at all. A
///      provider that withholds its reveal is a liveness failure only, covered
///      by the pool's existing `requestTimeout` refund path.
///
///      The user contribution is derived on-chain (request id + previous
///      blockhash + timestamp). That is deliberately weak entropy: it only has
///      to be unknown to the provider *at commitment time*, which anything
///      derived from post-commitment chain state satisfies. The provider's
///      value is the strong half.
///
///      Fees: Entropy charges a native-token fee per request (HYPE here).
///      The router's `requestRandomness` call is non-payable, so the adapter
///      pays from its own balance — prefund it (plain transfer) and top it up
///      as part of keeper/ops runbooks. A request with an underfunded adapter
///      reverts loudly rather than wiring a draw that can never resolve.
///
///      Skeleton status: compiled + unit-tested against a mock Entropy; wire
///      the canonical entropy-sdk-solidity interfaces and the chain's
///      published Entropy contract + provider (docs.pyth.network, verified on
///      the explorer) before mainnet.
contract PythEntropyAdapter is IRandomnessAdapter, Ownable {
    address public immutable router;

    IEntropyLike public entropy;
    address public provider;

    /// @notice entropy sequence number => router request id (0 = unknown).
    mapping(uint64 => uint256) public routerRequestOf;
    /// @notice requests issued but not yet fulfilled — blocks an entropy-contract
    ///         swap that would orphan them.
    uint256 public outstanding;

    event Configured(address entropy, address provider);
    event EntropyRequested(uint256 indexed routerRequestId, uint64 indexed sequenceNumber, uint128 fee);
    event EntropyFulfilled(uint256 indexed routerRequestId, uint64 indexed sequenceNumber);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address router_, address initialOwner) Ownable(initialOwner) {
        require(router_ != address(0), "PEA: zero");
        router = router_;
    }

    /// @notice Accepts the native-token prefund that pays per-request fees.
    receive() external payable {}

    function configure(IEntropyLike entropy_, address provider_) external onlyOwner {
        require(address(entropy_) != address(0) && provider_ != address(0), "PEA: zero");
        // The provider may be retuned anytime (Entropy keys requests by
        // sequence number, not provider), but the entropy contract ADDRESS
        // cannot change while requests are outstanding — the old contract's
        // callback would fail msg.sender and orphan them.
        require(entropy_ == entropy || outstanding == 0, "PEA: requests outstanding");
        entropy = entropy_;
        provider = provider_;
        emit Configured(address(entropy_), provider_);
    }

    /// @notice Recover prefunded fee balance (e.g. after a router/adapter swap).
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "PEA: zero");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "PEA: withdraw failed");
        emit Withdrawn(to, amount);
    }

    /// @inheritdoc IRandomnessAdapter
    function requestRandomness(uint256 routerRequestId) external returns (bytes32) {
        require(msg.sender == router, "PEA: only router");
        require(address(entropy) != address(0), "PEA: not configured");
        uint128 fee = entropy.getFee(provider);
        require(address(this).balance >= fee, "PEA: underfunded");
        bytes32 userRandom =
            keccak256(abi.encode(address(this), routerRequestId, blockhash(block.number - 1), block.timestamp));
        uint64 sequenceNumber = entropy.requestWithCallback{value: fee}(provider, userRandom);
        // Entropy never reuses sequence numbers, but guard anyway: a collision
        // would silently orphan the earlier request.
        require(routerRequestOf[sequenceNumber] == 0, "PEA: id in use");
        routerRequestOf[sequenceNumber] = routerRequestId;
        outstanding += 1;
        emit EntropyRequested(routerRequestId, sequenceNumber, fee);
        return bytes32(uint256(sequenceNumber));
    }

    /// @notice Entropy delivery callback. This is the exact external selector
    ///         the Entropy contract invokes on consumers (the SDK's
    ///         IEntropyConsumer base wraps it; here it is implemented
    ///         directly). Only the entropy contract may deliver, each request
    ///         fulfils once, and the router's consumer callback is store-only
    ///         downstream.
    function _entropyCallback(uint64 sequenceNumber, address, bytes32 randomNumber) external {
        require(msg.sender == address(entropy), "PEA: only entropy");
        uint256 routerRequestId = routerRequestOf[sequenceNumber];
        require(routerRequestId != 0, "PEA: unknown request");
        delete routerRequestOf[sequenceNumber];
        outstanding -= 1;
        emit EntropyFulfilled(routerRequestId, sequenceNumber);
        IRandomnessRouter(router).fulfill(routerRequestId, uint256(randomNumber));
    }
}
