// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC-20 whose transfers can be paused — models a tokenized equity
///         whose issuer can freeze it, used to test EquityBasket's
///         non-reverting unwrap payout.
contract PausableMockERC20 is ERC20 {
    bool public paused;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!paused, "PME: paused");
        super._update(from, to, value);
    }
}
