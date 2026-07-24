// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title FWAToken ($FWA)
/// @notice Fake World Assets reward token. Capped supply, role-gated minting,
///         a 1% fee applied only to DEX trades (routed to a fee wallet), and a
///         launch gate that keeps transfers closed to non-exempt parties until
///         the market is opened.
/// @dev Fee-on-DEX-trade replaces FWA's Uniswap-v4-hook fee, since a v4
///      PoolManager is not confirmed on RobinhoodChain (see Fase 0 gate).
contract FWAToken is ERC20Capped, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 100; // 1%

    address public feeWallet;
    bool public transfersOpen;
    mapping(address => bool) public feeExempt;
    mapping(address => bool) public isDexPair;

    event TransfersOpened();
    event FeeWalletUpdated(address indexed feeWallet);
    event FeeExemptSet(address indexed account, bool exempt);
    event DexPairSet(address indexed pair, bool isPair);

    constructor(uint256 cap_, address admin, address feeWallet_)
        ERC20("Fake World Assets", "FWA")
        ERC20Capped(cap_)
    {
        require(admin != address(0) && feeWallet_ != address(0), "FWA: zero");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        feeWallet = feeWallet_;
        feeExempt[admin] = true;
        feeExempt[feeWallet_] = true;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function openTransfers() external onlyRole(DEFAULT_ADMIN_ROLE) {
        transfersOpen = true;
        emit TransfersOpened();
    }

    function setFeeWallet(address w) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(w != address(0), "FWA: zero");
        feeWallet = w;
        emit FeeWalletUpdated(w);
    }

    function setFeeExempt(address account, bool exempt) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeExempt[account] = exempt;
        emit FeeExemptSet(account, exempt);
    }

    function setDexPair(address pair, bool value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isDexPair[pair] = value;
        emit DexPairSet(pair, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        bool isTransfer = from != address(0) && to != address(0);

        // Launch gate: before the market opens, only mint/burn or exempt parties move tokens.
        if (isTransfer && !transfersOpen) {
            require(feeExempt[from] || feeExempt[to], "FWA: transfers closed");
        }

        uint256 fee;
        if (isTransfer && (isDexPair[from] || isDexPair[to]) && !feeExempt[from] && !feeExempt[to]) {
            fee = (value * FEE_BPS) / BPS;
        }

        if (fee > 0) {
            super._update(from, feeWallet, fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
