// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FenwickTree} from "../libraries/FenwickTree.sol";

/// @dev Test-only harness exposing the FenwickTree library.
contract FenwickHarness {
    using FenwickTree for FenwickTree.Tree;

    FenwickTree.Tree private t;

    function update(uint256 i, int256 d) external {
        t.update(i, d);
    }

    function prefixSum(uint256 i) external view returns (uint256) {
        return t.prefixSum(i);
    }

    function total() external view returns (uint256) {
        return t.total;
    }

    function size() external view returns (uint256) {
        return t.size;
    }

    function findByPrefix(uint256 target) external view returns (uint256) {
        return t.findByPrefix(target);
    }
}
