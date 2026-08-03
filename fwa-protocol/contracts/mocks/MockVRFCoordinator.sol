// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVRFCoordinatorV25Like, VRFDirectAdapter} from "../randomness/VRFDirectAdapter.sol";

/// @notice Test double for the VRF v2.5 coordinator: records requests and lets
///         a test deliver words manually.
contract MockVRFCoordinator is IVRFCoordinatorV25Like {
    uint256 public requestCounter;
    mapping(uint256 => address) public requesterOf;

    function requestRandomWords(RandomWordsRequest calldata) external returns (uint256 requestId) {
        requestId = ++requestCounter;
        requesterOf[requestId] = msg.sender;
    }

    function fulfill(uint256 requestId, uint256 word) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        VRFDirectAdapter(requesterOf[requestId]).rawFulfillRandomWords(requestId, words);
    }
}
