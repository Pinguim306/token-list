// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EquityBasket
/// @notice Wraps fungible tokenized equities (Robinhood tokenized stocks and
///         the like) into an ERC-721 so they can enter the FWA pool, which only
///         understands NFT + backing. This is the StockRip trick reduced to its
///         essence: the NFT is *packaging* — ownership of the basket token IS
///         ownership of the shares inside it.
///
/// @dev Where StockRip binds each basket to an ERC-6551 token-bound account,
///      this contract keeps a plain internal ledger: the ERC-20s sit in this
///      contract, `_contents[basketId]` records what each basket owns, and
///      whoever holds the ERC-721 may `unwrap` it. Simpler, cheaper, and fully
///      sufficient for the pool flow (the pool moves the ERC-721 with plain
///      `transferFrom`, never touching the underlying shares).
///
///      The pool needs zero changes: the basket collection is whitelisted like
///      any other ERC-721, the pool escrows/delivers the basket token, and the
///      draw winner unwraps at their leisure.
///
///      Safety choices:
///        - only owner-allowlisted equity tokens can be wrapped (an arbitrary
///          ERC-20 could lie in transferFrom);
///        - deposits are measured by balance delta, so fee-on-transfer tokens
///          are recorded at what actually arrived;
///        - `unwrap` burns the ERC-721 *before* any token leaves (CEI), on top
///          of a reentrancy guard;
///        - `wrap` uses `_mint`, not `_safeMint` — no receiver callback, no
///          reentrancy window;
///        - token lists must be strictly ascending by address: canonical order
///          and duplicate rejection in one check.
///        - NON-REVERTING PAYOUT. Tokenized equities are frequently
///          pausable/upgradeable by their issuer. If one leg's transfer reverts
///          at unwrap time, that leg is escrowed for a later pull-based
///          `claimStuckToken` instead of bricking the whole basket — the same
///          principle FWAPool applies to NFT delivery. The basket still burns
///          and the healthy legs still pay out.
///
///      Trust assumptions (owner-curated allowlist): wrapped tokens are assumed
///      NON-REBASING. A negative-rebasing token could leave the contract short
///      of a recorded amount, escrowing that leg until (if ever) the balance
///      recovers. Standard tokenized equities do not rebase.
contract EquityBasket is ERC721, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Caps unwrap gas; 16 legs is already a generous "index" basket.
    uint256 public constant MAX_TOKENS = 16;

    struct Holding {
        address token;
        uint256 amount;
    }

    /// @notice Equity tokens approved for wrapping.
    mapping(address => bool) public allowedToken;
    /// @notice Total baskets ever minted (token ids are 1..basketCount).
    uint256 public basketCount;
    mapping(uint256 => Holding[]) private _contents;

    /// @notice token => account => amount escrowed because a payout transfer
    ///          reverted (e.g. the token was paused at unwrap time). Pulled by
    ///          the rightful recipient via `claimStuckToken` once transfers work.
    mapping(address => mapping(address => uint256)) public stuckToken;

    event TokenAllowed(address indexed token, bool allowed);
    event Wrapped(uint256 indexed basketId, address indexed owner, address[] tokens, uint256[] amounts);
    event Unwrapped(uint256 indexed basketId, address indexed to);
    event TokenEscrowed(address indexed token, address indexed to, uint256 amount);
    event StuckTokenClaimed(address indexed token, address indexed account, uint256 amount);

    constructor(address initialOwner) ERC721("FWA Equity Basket", "FWAEB") Ownable(initialOwner) {}

    /// @notice Curate which equity tokens may be wrapped.
    function setTokenAllowed(address token, bool value) external onlyOwner {
        require(token != address(0), "EB: zero");
        allowedToken[token] = value;
        emit TokenAllowed(token, value);
    }

    /// @notice Deposit equity tokens and mint the basket ERC-721 that owns them.
    /// @param tokens Strictly ascending list of allowlisted equity tokens.
    /// @param amounts Amount of each token to wrap (recorded at received value).
    function wrap(address[] calldata tokens, uint256[] calldata amounts)
        external
        nonReentrant
        returns (uint256 basketId)
    {
        uint256 n = tokens.length;
        require(n > 0 && n <= MAX_TOKENS, "EB: token count");
        require(amounts.length == n, "EB: length mismatch");

        basketId = ++basketCount;
        Holding[] storage contents = _contents[basketId];
        uint256[] memory received = new uint256[](n);

        address prev = address(0);
        for (uint256 i = 0; i < n; i++) {
            address token = tokens[i];
            require(token > prev, "EB: unsorted or duplicate");
            prev = token;
            require(allowedToken[token], "EB: token not allowed");
            require(amounts[i] > 0, "EB: amount=0");

            uint256 before = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), amounts[i]);
            uint256 got = IERC20(token).balanceOf(address(this)) - before;
            require(got > 0, "EB: nothing received");
            received[i] = got;
            contents.push(Holding({token: token, amount: got}));
        }

        _mint(msg.sender, basketId);
        emit Wrapped(basketId, msg.sender, tokens, received);
    }

    /// @notice Burn a basket you own and release its underlying shares to `to`.
    /// @dev A leg whose transfer reverts (e.g. a paused equity token) is escrowed
    ///      for `to` rather than reverting the whole unwrap. The basket burns and
    ///      the healthy legs pay out regardless.
    function unwrap(uint256 basketId, address to) external nonReentrant {
        require(ownerOf(basketId) == msg.sender, "EB: not owner");
        require(to != address(0), "EB: zero");

        // Effects before interactions: the basket ceases to exist, then pays out.
        Holding[] memory contents = _contents[basketId];
        delete _contents[basketId];
        _burn(basketId);

        for (uint256 i = 0; i < contents.length; i++) {
            _payOrEscrow(contents[i].token, to, contents[i].amount);
        }
        emit Unwrapped(basketId, to);
    }

    /// @notice Pull tokens escrowed for you when an unwrap payout could not be
    ///         delivered (e.g. the token was paused). Reverts if the token still
    ///         cannot transfer — the balance is preserved, try again later.
    function claimStuckToken(address token) external nonReentrant {
        uint256 amount = stuckToken[token][msg.sender];
        require(amount > 0, "EB: nothing stuck");
        stuckToken[token][msg.sender] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit StuckTokenClaimed(token, msg.sender, amount);
    }

    /// @dev Non-reverting delivery: attempt the transfer; on any failure (revert
    ///      or a non-conforming false return) record the amount for a later pull.
    ///      Mirrors OpenZeppelin's SafeERC20 success criterion without reverting.
    function _payOrEscrow(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        // Success = call ok AND (no return data OR a full 32-byte word decoding
        // to true). A short/odd return length is treated as failure, never
        // decoded — so a hostile token cannot revert this helper and re-brick
        // the unwrap.
        bool delivered = ok && (data.length == 0 || (data.length >= 32 && abi.decode(data, (bool))));
        if (delivered) return;
        stuckToken[token][to] += amount;
        emit TokenEscrowed(token, to, amount);
    }

    /// @notice What a basket owns. Empty for burned or never-minted ids.
    function contentsOf(uint256 basketId) external view returns (Holding[] memory) {
        return _contents[basketId];
    }
}
