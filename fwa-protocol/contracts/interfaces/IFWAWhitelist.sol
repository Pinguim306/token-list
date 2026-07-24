// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFWAWhitelist {
    function isAllowed(address asset) external view returns (bool);
}
