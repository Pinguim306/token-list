// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRandomnessAdapter, IRandomnessRouter} from "../interfaces/IRandomness.sol";

/// @title MockRandomnessAdapter
/// @notice Deterministic, manually-driven randomness backend for tests and local
///         validation. `requestRandomness` records the request; a test then calls
///         `fulfill` to simulate the backend delivering a specific word.
contract MockRandomnessAdapter is IRandomnessAdapter {
    address public router;
    mapping(uint256 => bool) public pending;
    uint256[] public queue;

    constructor(address router_) {
        router = router_;
    }

    function requestRandomness(uint256 routerRequestId) external returns (bytes32) {
        require(msg.sender == router, "MRA: only router");
        pending[routerRequestId] = true;
        queue.push(routerRequestId);
        return bytes32(routerRequestId);
    }

    function queueLength() external view returns (uint256) {
        return queue.length;
    }

    /// @notice Test hook: deliver `word` for a specific pending request.
    function fulfill(uint256 routerRequestId, uint256 word) external {
        require(pending[routerRequestId], "MRA: not pending");
        pending[routerRequestId] = false;
        IRandomnessRouter(router).fulfill(routerRequestId, word);
    }
}
