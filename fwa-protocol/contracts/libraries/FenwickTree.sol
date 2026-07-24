// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FenwickTree
/// @notice Binary-indexed tree for O(log n) weighted random selection.
/// @dev Leaves are 1-indexed and map 1:1 to FWA position ids (never reused).
///      Removing a position is a lazy delete: subtract its weight, leaf becomes 0
///      and is naturally skipped by `findByPrefix`.
library FenwickTree {
    /// @dev Fixed index capacity (max leaves per tree). Updates always propagate
    ///      to ancestor nodes up to CAPACITY, independent of how many leaves are
    ///      currently allocated. This is REQUIRED for correctness with dynamic
    ///      growth: a leaf inserted while the tree is small must still reach the
    ///      higher-order nodes that later, larger indices will read through.
    ///      1 << 20 = 1,048,576 positions per pool (deploy more pools beyond that);
    ///      it also bounds every update/query at ~20 storage ops.
    uint256 internal constant CAPACITY = 1 << 20;

    struct Tree {
        uint256 size; // highest allocated leaf index
        uint256 total; // running sum of all leaf weights
        mapping(uint256 => uint256) nodes; // 1-indexed BIT nodes
    }

    function _lowbit(uint256 x) private pure returns (uint256) {
        // two's-complement lowest set bit; safe for x >= 1 in checked math.
        return x & (~x + 1);
    }

    /// @notice Apply a signed delta to leaf `i`, growing the tracked size if needed.
    function update(Tree storage t, uint256 i, int256 delta) internal {
        require(i >= 1 && i <= CAPACITY, "FT: index");
        if (delta == 0) return;
        if (i > t.size) t.size = i;

        if (delta > 0) {
            uint256 d = uint256(delta);
            t.total += d;
            for (uint256 x = i; x <= CAPACITY; x += _lowbit(x)) {
                t.nodes[x] += d;
            }
        } else {
            uint256 d = uint256(-delta);
            t.total -= d;
            for (uint256 x = i; x <= CAPACITY; x += _lowbit(x)) {
                t.nodes[x] -= d;
            }
        }
    }

    /// @notice Cumulative weight of leaves [1, i].
    function prefixSum(Tree storage t, uint256 i) internal view returns (uint256 s) {
        for (uint256 x = i; x > 0; x -= _lowbit(x)) {
            s += t.nodes[x];
        }
    }

    function _highBit(uint256 n) private pure returns (uint256 p) {
        if (n == 0) return 0;
        p = 1;
        while (p << 1 <= n) p <<= 1;
    }

    /// @notice Find the leaf whose cumulative-weight range contains `target`.
    /// @dev Returns the 1-based index such that prefixSum(idx-1) <= target < prefixSum(idx).
    ///      Caller MUST ensure target < total (i.e. tree non-empty).
    function findByPrefix(Tree storage t, uint256 target) internal view returns (uint256) {
        uint256 pos = 0;
        uint256 remaining = target;
        for (uint256 pw = _highBit(t.size); pw > 0; pw >>= 1) {
            uint256 next = pos + pw;
            if (next <= t.size && t.nodes[next] <= remaining) {
                pos = next;
                remaining -= t.nodes[next];
            }
        }
        return pos + 1;
    }
}
