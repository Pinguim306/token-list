// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice A consumer that receives a random word for one of its own draws.
interface IRandomnessConsumer {
    /// @dev MUST be resilient: never revert on a stale/unknown drawId. This is
    ///      the "callback never reverts" invariant that keeps randomness delivery
    ///      from being bricked by consumer-side state changes.
    function fulfillRandomness(uint256 drawId, uint256 randomWord) external;
}

/// @notice The router that consumers talk to and adapters fulfil through.
interface IRandomnessRouter {
    /// @dev Called by a consumer to request one random word for `drawId`.
    ///      Returns a router-scoped request id used as the adapter correlation id.
    function requestRandom(uint256 drawId) external returns (uint256 routerRequestId);

    /// @dev Called by the active adapter to deliver randomness for a request.
    function fulfill(uint256 routerRequestId, uint256 randomWord) external;
}

/// @notice A randomness backend (mock, Chainlink-VRF-via-CCIP, Pyth Entropy, ...).
interface IRandomnessAdapter {
    /// @dev Router calls this to kick off a randomness request. The adapter must
    ///      eventually call `IRandomnessRouter.fulfill(routerRequestId, word)`.
    function requestRandomness(uint256 routerRequestId) external returns (bytes32 requestId);
}
