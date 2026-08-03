// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRandomnessAdapter, IRandomnessRouter} from "../interfaces/IRandomness.sol";

/// @dev Minimal local mirror of the Chainlink VRF v2.5 coordinator surface —
///      same convention as CCIPTypes.sol: no external package dependency here;
///      swap in the canonical Chainlink contracts package interfaces before
///      mainnet.
interface IVRFCoordinatorV25Like {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function requestRandomWords(RandomWordsRequest calldata req) external returns (uint256 requestId);
}

/// @title VRFDirectAdapter
/// @notice Chainlink VRF v2.5 randomness for the RandomnessRouter — DIRECT,
///         no CCIP hop. On BNB Chain VRF is natively available, so the
///         cross-chain relay the original design needed (CCIPVRFAdapter +
///         VRFRequester) collapses into this single subscription consumer.
///
/// @dev Trust upgrade over KeeperHashChainAdapter: the random word is
///      cryptographically verifiable and no keeper can selectively abort.
///      Operational costs: a funded VRF subscription (LINK or native), and
///      fulfilment latency of a few blocks. The router indirection means
///      swapping keeper -> VRF is one `setAdapter` call, zero pool changes.
///
///      Skeleton status: compiled + unit-tested against a mock coordinator;
///      wire the canonical Chainlink interfaces and the production
///      keyHash/subId before mainnet.
contract VRFDirectAdapter is IRandomnessAdapter, Ownable {
    address public immutable router;

    IVRFCoordinatorV25Like public coordinator;
    bytes32 public keyHash;
    uint256 public subId;
    // Generous default: the router's consumer callback (FWAPool) is store-only,
    // but a comfortable margin across the coordinator->adapter->router->consumer
    // hops (and the 63/64 gas rule) keeps a fulfilment from being starved.
    uint32 public callbackGasLimit = 500_000;
    uint16 public requestConfirmations = 3;

    /// @notice vrf request id => router request id (0 = unknown).
    mapping(uint256 => uint256) public routerRequestOf;
    /// @notice requests issued but not yet fulfilled — blocks a coordinator
    ///         swap that would orphan them.
    uint256 public outstanding;

    event Configured(address coordinator, bytes32 keyHash, uint256 subId, uint32 gasLimit, uint16 confirmations);
    event VRFRequested(uint256 indexed routerRequestId, uint256 indexed vrfRequestId);
    event VRFFulfilled(uint256 indexed routerRequestId, uint256 indexed vrfRequestId);

    constructor(address router_, address initialOwner) Ownable(initialOwner) {
        require(router_ != address(0), "VDA: zero");
        router = router_;
    }

    function configure(
        IVRFCoordinatorV25Like coordinator_,
        bytes32 keyHash_,
        uint256 subId_,
        uint32 callbackGasLimit_,
        uint16 requestConfirmations_
    ) external onlyOwner {
        require(address(coordinator_) != address(0), "VDA: zero");
        // keyHash/subId/gas/confirmations may be retuned anytime, but the
        // coordinator ADDRESS cannot change while requests are outstanding —
        // the old coordinator's callback would fail msg.sender and orphan them.
        require(coordinator_ == coordinator || outstanding == 0, "VDA: requests outstanding");
        coordinator = coordinator_;
        keyHash = keyHash_;
        subId = subId_;
        callbackGasLimit = callbackGasLimit_;
        requestConfirmations = requestConfirmations_;
        emit Configured(address(coordinator_), keyHash_, subId_, callbackGasLimit_, requestConfirmations_);
    }

    /// @inheritdoc IRandomnessAdapter
    function requestRandomness(uint256 routerRequestId) external returns (bytes32) {
        require(msg.sender == router, "VDA: only router");
        require(address(coordinator) != address(0), "VDA: not configured");
        uint256 vrfRequestId = coordinator.requestRandomWords(
            IVRFCoordinatorV25Like.RandomWordsRequest({
                keyHash: keyHash,
                subId: subId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: ""
            })
        );
        // Canonical VRF never reuses ids, but guard anyway: a collision would
        // silently orphan the earlier request.
        require(routerRequestOf[vrfRequestId] == 0, "VDA: id in use");
        routerRequestOf[vrfRequestId] = routerRequestId;
        outstanding += 1;
        emit VRFRequested(routerRequestId, vrfRequestId);
        return bytes32(vrfRequestId);
    }

    /// @notice VRF coordinator callback (v2.5 `rawFulfillRandomWords` shape).
    ///         Only the coordinator may deliver, each request fulfils once,
    ///         and the router's consumer callback is store-only downstream.
    function rawFulfillRandomWords(uint256 vrfRequestId, uint256[] calldata randomWords) external {
        require(msg.sender == address(coordinator), "VDA: only coordinator");
        uint256 routerRequestId = routerRequestOf[vrfRequestId];
        require(routerRequestId != 0, "VDA: unknown request");
        require(randomWords.length > 0, "VDA: no words");
        delete routerRequestOf[vrfRequestId];
        outstanding -= 1;
        emit VRFFulfilled(routerRequestId, vrfRequestId);
        IRandomnessRouter(router).fulfill(routerRequestId, randomWords[0]);
    }
}
