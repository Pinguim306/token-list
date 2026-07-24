// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFWAEmitter} from "../interfaces/IFWAEmitter.sol";

/// @dev Emitter that reverts on every hook — proves the pool's guarded (try/catch)
///      notifications cannot be bricked by a misbehaving emitter.
contract RevertingEmitter is IFWAEmitter {
    function onDeposit(uint256, address, uint256) external pure { revert("boom"); }
    function onClose(uint256) external pure { revert("boom"); }
    function onPurchase(address) external pure { revert("boom"); }
}
