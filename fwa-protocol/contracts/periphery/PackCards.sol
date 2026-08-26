// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PackCards
/// @notice The collectible a buyer receives when they KEEP a ripped pack. Each
///         card is an ERC-721 tagged with the tokenized stock the pack drew, so
///         keeping is never "pay and get nothing" — the buyer holds a tradeable
///         on-chain card of their pull.
/// @dev Minted only by the PackRip checkout (the `minter`). `_mint` is used
///      instead of `_safeMint` on purpose: a keep() settlement must never
///      revert because the buyer is a contract without an ERC721 receiver —
///      the card lands regardless and settlement stays live.
contract PackCards is ERC721, Ownable {
    address public minter;
    uint256 public nextId;
    string private _base;

    /// @notice The tokenized stock the card's pack drew (ERC-20 address).
    mapping(uint256 => address) public stockOf;

    event MinterUpdated(address indexed minter);
    event BaseURIUpdated(string baseURI);

    constructor(address initialOwner) ERC721("FWA Pack Cards", "FWAPACK") Ownable(initialOwner) {}

    function setMinter(address minter_) external onlyOwner {
        minter = minter_;
        emit MinterUpdated(minter_);
    }

    function setBaseURI(string calldata base_) external onlyOwner {
        _base = base_;
        emit BaseURIUpdated(base_);
    }

    function _baseURI() internal view override returns (string memory) {
        return _base;
    }

    /// @notice Mint one card to `to`, tagged with the drawn stock.
    function mint(address to, address stock) external returns (uint256 id) {
        require(msg.sender == minter, "PC: not minter");
        id = ++nextId;
        stockOf[id] = stock;
        _mint(to, id);
    }
}
