// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRandomnessConsumer, IRandomnessRouter} from "../interfaces/IRandomness.sol";

/// @notice Minimal consumer for adapter tests: forwards requests to the router
///         and records what gets delivered back.
contract MockRandomnessConsumer is IRandomnessConsumer {
    IRandomnessRouter public immutable router;
    uint256 public lastDrawId;
    uint256 public lastWord;
    uint256 public fulfillments;

    constructor(IRandomnessRouter router_) {
        router = router_;
    }

    function request(uint256 drawId) external returns (uint256) {
        return router.requestRandom(drawId);
    }

    function fulfillRandomness(uint256 drawId, uint256 randomWord) external {
        lastDrawId = drawId;
        lastWord = randomWord;
        fulfillments += 1;
    }
}
