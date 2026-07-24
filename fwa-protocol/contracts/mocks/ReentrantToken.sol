// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IWithdrawCredit {
    function withdrawCredit() external;
}

/// @dev ERC20 whose transfer re-enters the pool's withdrawCredit to prove the
///      ReentrancyGuard + checks-effects-interactions ordering holds.
contract ReentrantToken is ERC20 {
    address public target;
    bool public attack;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTarget(address t) external {
        target = t;
    }

    function setAttack(bool a) external {
        attack = a;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attack && to != address(0) && target != address(0)) {
            attack = false; // one-shot to avoid infinite loop if guard were missing
            IWithdrawCredit(target).withdrawCredit();
        }
    }
}
