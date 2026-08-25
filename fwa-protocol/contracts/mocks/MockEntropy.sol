// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEntropyConsumerLike {
    function _entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external;
}

/// @notice Test double for the Pyth Entropy contract: collects the fee,
///         assigns sequence numbers, and lets tests drive the delivery
///         callback. Requests are intentionally NOT deleted on fulfil so the
///         adapter's own replay guard is what a double-delivery test exercises.
contract MockEntropy {
    uint128 public fee;
    uint64 public sequenceCounter;
    mapping(uint64 => address) public requesterOf;
    mapping(uint64 => bytes32) public userRandomOf;

    function setFee(uint128 fee_) external {
        fee = fee_;
    }

    function getFee(address) external view returns (uint128) {
        return fee;
    }

    function requestWithCallback(address, bytes32 userRandomNumber) external payable returns (uint64 sequenceNumber) {
        require(msg.value >= fee, "ME: fee");
        sequenceNumber = ++sequenceCounter;
        requesterOf[sequenceNumber] = msg.sender;
        userRandomOf[sequenceNumber] = userRandomNumber;
    }

    function fulfill(uint64 sequenceNumber, address provider, bytes32 randomNumber) external {
        address requester = requesterOf[sequenceNumber];
        require(requester != address(0), "ME: unknown");
        IEntropyConsumerLike(requester)._entropyCallback(sequenceNumber, provider, randomNumber);
    }
}
