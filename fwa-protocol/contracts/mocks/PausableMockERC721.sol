// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev ERC-721 whose transfers can be toggled off — models a pausable or
///      blocklisting collection that can revert `transferFrom` at settlement time.
contract PausableMockERC721 is ERC721 {
    bool public transfersFrozen;

    constructor() ERC721("Pausable", "PAUSE") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setFrozen(bool v) external {
        transfersFrozen = v;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        // allow mint (from == address(0)); block real transfers when frozen
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            require(!transfersFrozen, "PAUSE: frozen");
        }
        return super._update(to, tokenId, auth);
    }
}
