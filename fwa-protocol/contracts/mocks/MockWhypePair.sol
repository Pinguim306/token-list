// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice WETH9-style wrapped-HYPE test double.
contract MockWHYPE {
    string public constant name = "Wrapped HYPE";
    string public constant symbol = "WHYPE";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 value) external {
        balanceOf[msg.sender] -= value;
        (bool ok, ) = msg.sender.call{value: value}("");
        require(ok, "WHYPE: send");
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
}

/// @notice Honest Uniswap-V2-pair test double for the HFWA/WHYPE pool: real
///         reserves, real constant-product K check at the 0.3% fee, tokens
///         actually move. `sync()` after seeding sets the reserves.
contract MockUniV2Pair {
    address public immutable token0;
    address public immutable token1;
    uint112 private reserve0;
    uint112 private reserve1;

    constructor(address token0_, address token1_) {
        require(token0_ < token1_, "pair: order");
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, uint32(block.timestamp));
    }

    function sync() external {
        reserve0 = uint112(_balance(token0));
        reserve1 = uint112(_balance(token1));
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        require(amount0Out < reserve0 && amount1Out < reserve1, "pair: liquidity");
        if (amount0Out > 0) require(IERC20(token0).transfer(to, amount0Out), "pair: t0");
        if (amount1Out > 0) require(IERC20(token1).transfer(to, amount1Out), "pair: t1");

        uint256 balance0 = _balance(token0);
        uint256 balance1 = _balance(token1);
        uint256 in0 = balance0 > reserve0 - amount0Out ? balance0 - (reserve0 - amount0Out) : 0;
        uint256 in1 = balance1 > reserve1 - amount1Out ? balance1 - (reserve1 - amount1Out) : 0;
        require(in0 > 0 || in1 > 0, "pair: no input");
        // K check with the 0.3% fee, verbatim UniswapV2 semantics.
        uint256 adj0 = balance0 * 1000 - in0 * 3;
        uint256 adj1 = balance1 * 1000 - in1 * 3;
        require(adj0 * adj1 >= uint256(reserve0) * reserve1 * 1000 ** 2, "pair: K");

        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }

    function _balance(address token) internal view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
