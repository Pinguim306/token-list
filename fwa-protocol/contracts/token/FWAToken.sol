// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title FWAToken — HyperFWA ($HFWA)
/// @notice HyperFWA, the Fake World Assets reward token on HyperEVM. Capped
///         supply, role-gated minting, and a launch gate that keeps transfers
///         closed to the public until the market is opened. It is a plain
///         ERC-20 on transfer — there is NO transfer fee — so it works cleanly
///         with DEX routers, aggregators, and CEX deposits (a fee-on-transfer
///         would break all three). Protocol revenue comes from the pack
///         mechanics, not a token tax. The name/symbol are the on-chain launch
///         identity; the project domain (hyperfwa.xyz) lives on the site, not
///         in the token name.
contract FWAToken is ERC20Capped, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    bool public transfersOpen;
    /// @notice Accounts allowed to move tokens before the market opens — the
    ///         deployer distributing supply, the emitter, the claim contract.
    mapping(address => bool) public launchAllowed;

    event TransfersOpened();
    event LaunchAllowedSet(address indexed account, bool allowed);

    constructor(uint256 cap_, address admin)
        ERC20("HyperFWA", "HFWA")
        ERC20Capped(cap_)
    {
        require(admin != address(0), "FWA: zero");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        launchAllowed[admin] = true;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function openTransfers() external onlyRole(DEFAULT_ADMIN_ROLE) {
        transfersOpen = true;
        emit TransfersOpened();
    }

    /// @notice Allow (or disallow) an account to move tokens before the market
    ///         opens. Used to seed distribution/emissions/claims pre-launch.
    function setLaunchAllowed(address account, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        launchAllowed[account] = allowed;
        emit LaunchAllowedSet(account, allowed);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Launch gate: before the market opens, only mint/burn or an
        // allowlisted party may move tokens. No fee is ever taken.
        if (from != address(0) && to != address(0) && !transfersOpen) {
            require(launchAllowed[from] || launchAllowed[to], "FWA: transfers closed");
        }
        super._update(from, to, value);
    }
}
