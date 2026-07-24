// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRandomnessRouter, IRandomnessConsumer, IRandomnessAdapter} from "../interfaces/IRandomness.sol";

/// @title RandomnessRouter
/// @notice Single indirection point between consumers (FWA pools) and a swappable
///         randomness backend (adapter). Keeps consumers agnostic to whether the
///         randomness comes from Chainlink-VRF-over-CCIP, Pyth Entropy, or a mock.
/// @dev The fulfil path performs a *minimal* consumer callback (store only). The
///      consumer's own settlement is a separate, permissionless step.
contract RandomnessRouter is IRandomnessRouter, Ownable {
    struct Request {
        address consumer;
        uint256 drawId;
        bool fulfilled;
    }

    IRandomnessAdapter public adapter;
    uint256 public requestCounter;
    mapping(uint256 => Request) public requests; // routerRequestId => Request
    mapping(address => bool) public authorizedConsumer;

    event AdapterUpdated(address indexed adapter);
    event ConsumerAuthorized(address indexed consumer, bool allowed);
    event RandomRequested(uint256 indexed routerRequestId, address indexed consumer, uint256 drawId);
    event RandomFulfilled(uint256 indexed routerRequestId, uint256 randomWord);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setAdapter(IRandomnessAdapter adapter_) external onlyOwner {
        adapter = adapter_;
        emit AdapterUpdated(address(adapter_));
    }

    function setConsumer(address consumer, bool allowed) external onlyOwner {
        authorizedConsumer[consumer] = allowed;
        emit ConsumerAuthorized(consumer, allowed);
    }

    /// @inheritdoc IRandomnessRouter
    function requestRandom(uint256 drawId) external returns (uint256 routerRequestId) {
        require(authorizedConsumer[msg.sender], "RR: not consumer");
        require(address(adapter) != address(0), "RR: no adapter");
        routerRequestId = ++requestCounter;
        requests[routerRequestId] = Request({consumer: msg.sender, drawId: drawId, fulfilled: false});
        emit RandomRequested(routerRequestId, msg.sender, drawId);
        adapter.requestRandomness(routerRequestId);
    }

    /// @inheritdoc IRandomnessRouter
    function fulfill(uint256 routerRequestId, uint256 randomWord) external {
        require(msg.sender == address(adapter), "RR: not adapter");
        Request storage r = requests[routerRequestId];
        require(r.consumer != address(0) && !r.fulfilled, "RR: bad request");
        r.fulfilled = true;
        emit RandomFulfilled(routerRequestId, randomWord);
        // Minimal, resilient callback: the consumer stores the word and must not revert.
        IRandomnessConsumer(r.consumer).fulfillRandomness(r.drawId, randomWord);
    }
}
