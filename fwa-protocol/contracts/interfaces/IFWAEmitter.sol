// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Emissions sink notified by an FWA pool. All hooks are called from the
///         pool wrapped in try/catch, so an implementation MUST NOT be relied on to
///         revert the pool — and a buggy emitter can never brick pool operations.
interface IFWAEmitter {
    function onDeposit(uint256 positionId, address depositor, uint256 backing) external;
    function onClose(uint256 positionId) external;
    function onPurchase(address buyer) external;
}
