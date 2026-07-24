// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFWAWhitelist} from "../interfaces/IFWAWhitelist.sol";

/// @title FWAWhitelist
/// @notice Curates which ERC-721 collections may be deposited. Blocking is
///         "sticky": once blocked, a collection can never be re-allowed, so a
///         compromised/rug collection cannot be quietly re-listed.
contract FWAWhitelist is IFWAWhitelist, Ownable {
    mapping(address => bool) public allowed;
    mapping(address => bool) public stickyBlocked;

    event AllowedSet(address indexed asset, bool allowed);
    event Blocked(address indexed asset);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setAllowed(address asset, bool value) external onlyOwner {
        require(!stickyBlocked[asset], "FW: blocked");
        allowed[asset] = value;
        emit AllowedSet(asset, value);
    }

    function blockAsset(address asset) external onlyOwner {
        stickyBlocked[asset] = true;
        allowed[asset] = false;
        emit Blocked(asset);
    }

    function isAllowed(address asset) external view returns (bool) {
        return allowed[asset] && !stickyBlocked[asset];
    }
}
