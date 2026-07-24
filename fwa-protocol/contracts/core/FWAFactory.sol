// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IRandomnessRouter} from "../interfaces/IRandomness.sol";
import {IFWAWhitelist} from "../interfaces/IFWAWhitelist.sol";
import {FWAPool} from "./FWAPool.sol";

/// @title FWAFactory
/// @notice Deploys and registers FWA pools. The core pool is collection-agnostic
///         (a single pool can hold any whitelisted collection), so pools are keyed
///         by their backing token / configuration rather than per NFT collection.
contract FWAFactory is Ownable {
    address[] public allPools;
    mapping(address => bool) public isPool;

    event PoolCreated(address indexed pool, address indexed backingToken, address router, address whitelist, address feeRouter);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function createPool(
        IERC20 backingToken,
        IRandomnessRouter router,
        IFWAWhitelist whitelist,
        address feeRouter,
        address poolOwner
    ) external onlyOwner returns (address pool) {
        FWAPool p = new FWAPool(backingToken, router, whitelist, feeRouter, poolOwner);
        pool = address(p);
        allPools.push(pool);
        isPool[pool] = true;
        emit PoolCreated(pool, address(backingToken), address(router), address(whitelist), feeRouter);
    }

    function poolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
