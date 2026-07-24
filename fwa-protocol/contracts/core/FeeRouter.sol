// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPoolCredit {
    function withdrawCredit() external;
}

/// @title FeeRouter
/// @notice Destination for protocol fees. Pools accrue fees to this address as a
///         pull-based credit; `collect` pulls them here, `distribute` splits the
///         balance across configured recipients by basis-point shares.
contract FeeRouter is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    address[] public recipients;
    uint256[] public sharesBps;

    event RecipientsUpdated(address[] recipients, uint256[] sharesBps);
    event Collected(address indexed pool);
    event Distributed(address indexed token, uint256 amount);

    constructor(address initialOwner, address[] memory recipients_, uint256[] memory sharesBps_) Ownable(initialOwner) {
        _setRecipients(recipients_, sharesBps_);
    }

    function setRecipients(address[] memory recipients_, uint256[] memory sharesBps_) external onlyOwner {
        _setRecipients(recipients_, sharesBps_);
    }

    function _setRecipients(address[] memory recipients_, uint256[] memory sharesBps_) internal {
        require(recipients_.length == sharesBps_.length && recipients_.length > 0, "FR: length");
        uint256 sum;
        for (uint256 i; i < sharesBps_.length; i++) {
            require(recipients_[i] != address(0), "FR: zero recipient");
            sum += sharesBps_[i];
        }
        require(sum == BPS, "FR: shares != BPS");
        recipients = recipients_;
        sharesBps = sharesBps_;
        emit RecipientsUpdated(recipients_, sharesBps_);
    }

    /// @notice Pull this router's accrued credit out of a pool into this contract.
    function collect(address pool) external {
        IPoolCredit(pool).withdrawCredit();
        emit Collected(pool);
    }

    /// @notice Split the full `token` balance held here across recipients.
    function distribute(IERC20 token) external {
        uint256 bal = token.balanceOf(address(this));
        require(bal > 0, "FR: nothing");
        uint256 distributed;
        for (uint256 i; i < recipients.length; i++) {
            uint256 amt = i == recipients.length - 1 ? bal - distributed : (bal * sharesBps[i]) / BPS;
            distributed += amt;
            if (amt > 0) token.safeTransfer(recipients[i], amt);
        }
        emit Distributed(address(token), bal);
    }

    function recipientsLength() external view returns (uint256) {
        return recipients.length;
    }
}
