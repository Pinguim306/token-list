// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PackCards} from "./PackCards.sol";

/// @dev Minimal mirrors (repo convention: no external packages; the live
///      HyperSwap V2 pair was exercised on-chain via these exact selectors).
interface IWHYPE {
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IUniswapV2PairLike {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title PackRip
/// @notice The on-chain pack checkout. Buying a pack pays the flat price in
///         native HYPE: the dev cut goes straight to the treasury and the
///         standing-bid share (85% by default) is escrowed per buyer. The buyer
///         then chooses, inside the settlement window, one of THREE outcomes:
///           - `keep`: the buyer keeps the pull as a collectible — a PackCards
///             ERC-721 tagged with the drawn stock is minted to them; the
///             escrow is released to the treasury.
///           - `sellBack`: the escrow is market-bought into $HFWA through the
///             HFWA/WHYPE pair and delivered to the buyer — every sell-back is
///             buy pressure on the token (the FWA/StockRip funnel).
///           - `takeShares`: the buyer receives the pack's escrow VALUE in the
///             drawn tokenized stock itself (HyperCore-linked dStock tokens),
///             priced live from HyperCore via the spotPx/BBO precompiles and
///             paid out of this contract's on-chain stock inventory; the
///             escrow HYPE is released to the treasury, which replenishes the
///             inventory on the Core spot book.
///         After the window anyone may `finalize` a buyer — default Keep
///         (escrow to treasury, no card: the drawn stock is unknown to a third
///         party) — so escrow can never be stranded.
///
/// @dev The $HFWA swap runs DIRECTLY against the V2 pair (wrap HYPE -> WHYPE,
///      transfer to pair, `swap` with the constant-product output at the
///      pair's 0.3% fee). The router's native-HYPE helpers proved unreliable
///      against HyperEVM's system WHYPE; the bare pair path was executed
///      live on chain 999. Buyer-supplied `minOut` gives slippage protection.
///
///      Share pricing reads HyperCore through the read precompiles, verified
///      live on chain 999 (spotPx(107) matched allMids HYPE to 4 decimals):
///        - spotPx (0x...0808): input `abi.encode(uint32 spotPairIndex)`,
///          returns uint64 raw price scaled by 10^(8 - szDecimals(base)).
///        - bbo (0x...080e): input `abi.encode(uint32 10000 + spotPairIndex)`,
///          returns (uint64 bid, uint64 ask) at the same scale.
///      Delivery is priced conservatively — the stock at max(spotPx, best ask),
///      the HYPE credit at min(spotPx, best bid) — so crashing a thin book
///      cannot mint shares above live market value. Only owner-allowlisted
///      stocks (healthy books) are deliverable, and `minShares` protects the
///      buyer against adverse moves between quote and settle.
///
///      Batches merge: a new rip while packs are pending resets the single
///      per-buyer deadline (documented trade-off for O(1) storage). The owner
///      can retune price/bid/window for FUTURE rips; escrowed value is
///      untouchable by the owner except through the buyer's own settle or the
///      post-window default-Keep. Stock inventory is protocol capital (never
///      buyer escrow) so the owner may withdraw it anytime via `rescueToken`.
contract PackRip is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PACKS_PER_TX = 20;

    /// @dev HyperCore read precompiles (chain 999), exercised live.
    address internal constant SPOT_PX_PRECOMPILE = 0x0000000000000000000000000000000000000808;
    address internal constant BBO_PRECOMPILE = 0x000000000000000000000000000000000000080e;
    /// @dev BBO addresses spot books at 10000 + spot pair index.
    uint32 internal constant BBO_SPOT_OFFSET = 10_000;

    IERC20 public immutable hfwa;
    IWHYPE public immutable whype;
    IUniswapV2PairLike public immutable pair;
    PackCards public immutable cards;
    bool private immutable hfwaIsToken0;

    address public treasury;
    uint256 public packPrice; // wei of native HYPE per pack
    uint256 public bidBps; // escrowed (sell-back) share of the price
    uint256 public settlementWindow; // seconds the buyer alone may settle

    /// @notice HYPE/USDC spot market used to value the escrow (pair @107 on
    ///         chain 999; szDecimals 2 -> pxScale 1e6).
    uint32 public hypeSpotIndex = 107;
    uint64 public hypePxScale = 1e6;

    /// @notice A deliverable tokenized stock: its HyperCore spot pair and the
    ///         price scale 10^(8 - szDecimals(base)) of that pair.
    struct StockMarket {
        uint32 spotIndex;
        uint64 pxScale;
        bool allowed;
    }

    mapping(address => StockMarket) public stocks;

    struct Pending {
        uint128 packs;
        uint128 escrow; // total wei escrowed for those packs
        uint64 deadline; // last rip's timestamp + settlementWindow
    }

    mapping(address => Pending) public pending;

    event Ripped(address indexed buyer, uint256 packs, uint256 paid, uint256 escrowed, uint256 devCut);
    event SoldBack(address indexed buyer, uint256 packs, uint256 escrowSpent, uint256 hfwaOut);
    event Kept(address indexed buyer, uint256 packs, uint256 escrowReleased);
    event SharesTaken(
        address indexed buyer,
        uint256 packs,
        uint256 escrowSpent,
        address indexed stock,
        uint256 sharesOut,
        uint256 stockPxE8,
        uint256 hypePxE8
    );
    event Finalized(address indexed buyer, uint256 packs, uint256 escrowReleased);
    event ParamsUpdated(uint256 packPrice, uint256 bidBps, uint256 settlementWindow);
    event TreasuryUpdated(address treasury);
    event StockSet(address indexed token, uint32 spotIndex, uint64 pxScale, bool allowed);
    event HypeMarketSet(uint32 spotIndex, uint64 pxScale);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    constructor(
        IERC20 hfwa_,
        IWHYPE whype_,
        IUniswapV2PairLike pair_,
        PackCards cards_,
        address treasury_,
        uint256 packPrice_,
        uint256 bidBps_,
        uint256 settlementWindow_,
        address initialOwner
    ) Ownable(initialOwner) {
        require(
            address(hfwa_) != address(0) && address(whype_) != address(0) && address(pair_) != address(0)
                && address(cards_) != address(0) && treasury_ != address(0),
            "PR: zero"
        );
        require(bidBps_ <= BPS && packPrice_ > 0, "PR: params");
        hfwa = hfwa_;
        whype = whype_;
        pair = pair_;
        cards = cards_;
        address t0 = pair_.token0();
        require(t0 == address(hfwa_) || t0 == address(whype_), "PR: pair mismatch");
        hfwaIsToken0 = t0 == address(hfwa_);
        treasury = treasury_;
        packPrice = packPrice_;
        bidBps = bidBps_;
        settlementWindow = settlementWindow_;
    }

    // ------------------------------------------------------------------ //
    //                                Buy                                 //
    // ------------------------------------------------------------------ //

    /// @notice Buy `qty` packs at the flat price. The dev cut moves to the
    ///         treasury immediately; the standing-bid share is escrowed.
    function ripPacks(uint256 qty) external payable nonReentrant {
        require(qty > 0 && qty <= MAX_PACKS_PER_TX, "PR: qty");
        uint256 cost = packPrice * qty;
        require(msg.value == cost, "PR: wrong value");

        uint256 escrowed = (cost * bidBps) / BPS;
        uint256 devCut = cost - escrowed;

        Pending storage p = pending[msg.sender];
        p.packs += uint128(qty);
        p.escrow += uint128(escrowed);
        p.deadline = uint64(block.timestamp + settlementWindow);

        (bool ok, ) = treasury.call{value: devCut}("");
        require(ok, "PR: treasury xfer");
        emit Ripped(msg.sender, qty, cost, escrowed, devCut);
    }

    // ------------------------------------------------------------------ //
    //                               Settle                               //
    // ------------------------------------------------------------------ //

    /// @notice Sell `count` pending packs back: their escrow is swapped into
    ///         $HFWA through the pair and sent to the buyer.
    /// @param minOut Slippage floor on the HFWA received, chosen by the buyer.
    function sellBack(uint256 count, uint256 minOut) external nonReentrant {
        uint256 escrowShare = _consume(msg.sender, count);
        uint256 out = _swapHypeForHfwa(escrowShare, minOut, msg.sender);
        emit SoldBack(msg.sender, count, escrowShare, out);
    }

    /// @notice Keep one pending pack per entry in `stockTokens`: a PackCards
    ///         collectible tagged with each pack's drawn stock is minted to the
    ///         buyer and the escrow goes to the treasury.
    function keep(address[] calldata stockTokens) external nonReentrant {
        uint256 count = stockTokens.length;
        for (uint256 i = 0; i < count; i++) {
            require(stocks[stockTokens[i]].allowed, "PR: stock");
        }
        uint256 escrowShare = _consume(msg.sender, count);
        for (uint256 i = 0; i < count; i++) {
            cards.mint(msg.sender, stockTokens[i]);
        }
        (bool ok, ) = treasury.call{value: escrowShare}("");
        require(ok, "PR: treasury xfer");
        emit Kept(msg.sender, count, escrowShare);
    }

    /// @notice Take `count` pending packs' escrow VALUE in the drawn stock:
    ///         the buyer receives dStock tokens from this contract's inventory
    ///         at the live HyperCore price; the escrow HYPE goes to the
    ///         treasury (which replenishes inventory on the Core book).
    /// @param minShares Slippage floor on the stock tokens received.
    function takeShares(uint256 count, address stockToken, uint256 minShares) external nonReentrant {
        StockMarket memory m = stocks[stockToken];
        require(m.allowed, "PR: stock");
        uint256 escrowShare = _consume(msg.sender, count);
        (uint256 sharesOut, uint256 stockPxE8, uint256 hypePxE8) = _sharesFor(escrowShare, m);
        require(sharesOut > 0 && sharesOut >= minShares, "PR: slippage");
        require(IERC20(stockToken).balanceOf(address(this)) >= sharesOut, "PR: inventory");
        (bool ok, ) = treasury.call{value: escrowShare}("");
        require(ok, "PR: treasury xfer");
        IERC20(stockToken).safeTransfer(msg.sender, sharesOut);
        emit SharesTaken(msg.sender, count, escrowShare, stockToken, sharesOut, stockPxE8, hypePxE8);
    }

    /// @notice After a buyer's window closes, anyone may finalize the default
    ///         outcome (Keep, cardless) so escrow never sits forever.
    function finalize(address buyer) external nonReentrant {
        Pending storage p = pending[buyer];
        require(p.packs > 0, "PR: nothing pending");
        require(block.timestamp > p.deadline, "PR: window open");
        uint256 packs = p.packs;
        uint256 escrowShare = p.escrow;
        delete pending[buyer];
        (bool ok, ) = treasury.call{value: escrowShare}("");
        require(ok, "PR: treasury xfer");
        emit Finalized(buyer, packs, escrowShare);
    }

    // ------------------------------------------------------------------ //
    //                               Quotes                               //
    // ------------------------------------------------------------------ //

    /// @notice Quote a sell-back: the escrow `count` packs would spend and the
    ///         HFWA the pair would currently return for it. The app reads this
    ///         to set a slippage floor before calling `sellBack`.
    function quoteSellBack(address buyer, uint256 count) external view returns (uint256 escrowShare, uint256 out) {
        escrowShare = _escrowShareOf(buyer, count);
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = hfwaIsToken0 ? (uint256(r1), uint256(r0)) : (uint256(r0), uint256(r1));
        uint256 amountInWithFee = escrowShare * 997;
        out = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    /// @notice Quote a take-shares settle: the escrow spent, the stock tokens
    ///         delivered at the live HyperCore prices, both prices (1e8 USD),
    ///         and the current deliverable inventory.
    function quoteTakeShares(address buyer, uint256 count, address stockToken)
        external
        view
        returns (uint256 escrowShare, uint256 sharesOut, uint256 stockPxE8, uint256 hypePxE8, uint256 inventory)
    {
        StockMarket memory m = stocks[stockToken];
        require(m.allowed, "PR: stock");
        escrowShare = _escrowShareOf(buyer, count);
        (sharesOut, stockPxE8, hypePxE8) = _sharesFor(escrowShare, m);
        inventory = IERC20(stockToken).balanceOf(address(this));
    }

    // ------------------------------------------------------------------ //
    //                              Internals                             //
    // ------------------------------------------------------------------ //

    function _escrowShareOf(address buyer, uint256 count) internal view returns (uint256 escrowShare) {
        Pending storage p = pending[buyer];
        require(count > 0 && count <= p.packs, "PR: count");
        escrowShare = count == p.packs ? p.escrow : (uint256(p.escrow) * count) / p.packs;
    }

    /// @dev Deduct `count` packs (and the proportional escrow) from the
    ///      caller's pending batch, inside the settlement window.
    function _consume(address buyer, uint256 count) internal returns (uint256 escrowShare) {
        Pending storage p = pending[buyer];
        require(count > 0 && count <= p.packs, "PR: count");
        require(block.timestamp <= p.deadline, "PR: window passed");
        // Proportional escrow; the last pack drains any rounding dust.
        escrowShare = count == p.packs ? p.escrow : (uint256(p.escrow) * count) / p.packs;
        p.packs -= uint128(count);
        p.escrow -= uint128(escrowShare);
        if (p.packs == 0) delete pending[buyer];
    }

    /// @dev Wrap native HYPE and swap it directly against the V2 pair using
    ///      the constant-product formula at the pair's 0.3% fee.
    function _swapHypeForHfwa(uint256 amountIn, uint256 minOut, address to) internal returns (uint256 out) {
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = hfwaIsToken0 ? (uint256(r1), uint256(r0)) : (uint256(r0), uint256(r1));
        uint256 amountInWithFee = amountIn * 997;
        out = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
        require(out >= minOut && out > 0, "PR: slippage");

        whype.deposit{value: amountIn}();
        require(whype.transfer(address(pair), amountIn), "PR: whype xfer");
        (uint256 out0, uint256 out1) = hfwaIsToken0 ? (out, uint256(0)) : (uint256(0), out);
        pair.swap(out0, out1, to, "");
    }

    /// @dev Stock tokens for `escrowWei` of HYPE: value the escrow at the
    ///      conservative HYPE price (min of spotPx and best bid) and buy at the
    ///      conservative stock price (max of spotPx and best ask). Both tokens
    ///      are 18-decimals so the 1e8 price scales cancel.
    function _sharesFor(uint256 escrowWei, StockMarket memory m)
        internal
        view
        returns (uint256 sharesOut, uint256 stockPxE8, uint256 hypePxE8)
    {
        stockPxE8 = _spotPxE8(m.spotIndex, m.pxScale);
        (, uint256 askE8) = _bboE8(m.spotIndex, m.pxScale);
        if (askE8 > stockPxE8) stockPxE8 = askE8;

        hypePxE8 = _spotPxE8(hypeSpotIndex, hypePxScale);
        (uint256 bidE8, ) = _bboE8(hypeSpotIndex, hypePxScale);
        if (bidE8 > 0 && bidE8 < hypePxE8) hypePxE8 = bidE8;

        require(stockPxE8 > 0 && hypePxE8 > 0, "PR: px");
        sharesOut = (escrowWei * hypePxE8) / stockPxE8;
    }

    /// @dev HyperCore spot price for a pair index, normalized to 1e8 USD.
    function _spotPxE8(uint32 spotIndex, uint64 pxScale) internal view returns (uint256) {
        (bool ok, bytes memory res) = SPOT_PX_PRECOMPILE.staticcall(abi.encode(spotIndex));
        require(ok && res.length >= 32, "PR: px read");
        uint256 raw = uint256(abi.decode(res, (uint64)));
        return (raw * 1e8) / pxScale;
    }

    /// @dev HyperCore best bid/ask for a spot pair, normalized to 1e8 USD.
    ///      Returns zeros when the book is empty or the precompile is absent
    ///      (callers fall back to spotPx alone).
    function _bboE8(uint32 spotIndex, uint64 pxScale) internal view returns (uint256 bidE8, uint256 askE8) {
        (bool ok, bytes memory res) = BBO_PRECOMPILE.staticcall(abi.encode(BBO_SPOT_OFFSET + spotIndex));
        if (!ok || res.length < 64) return (0, 0);
        (uint64 bid, uint64 ask) = abi.decode(res, (uint64, uint64));
        bidE8 = (uint256(bid) * 1e8) / pxScale;
        askE8 = (uint256(ask) * 1e8) / pxScale;
    }

    // ------------------------------------------------------------------ //
    //                                Admin                               //
    // ------------------------------------------------------------------ //

    function setParams(uint256 packPrice_, uint256 bidBps_, uint256 settlementWindow_) external onlyOwner {
        require(bidBps_ <= BPS && packPrice_ > 0, "PR: params");
        packPrice = packPrice_;
        bidBps = bidBps_;
        settlementWindow = settlementWindow_;
        emit ParamsUpdated(packPrice_, bidBps_, settlementWindow_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "PR: zero");
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    /// @notice Register (or retire) a deliverable stock. Requires an
    ///         18-decimals ERC-20 (all HyperCore-linked dStocks are) so the
    ///         share math needs no per-token decimal handling.
    function setStock(address token, uint32 spotIndex, uint64 pxScale, bool allowed) external onlyOwner {
        require(token != address(0), "PR: zero");
        if (allowed) {
            require(pxScale > 0 && pxScale <= 1e8, "PR: scale");
            require(IERC20Metadata(token).decimals() == 18, "PR: decimals");
        }
        stocks[token] = StockMarket({spotIndex: spotIndex, pxScale: pxScale, allowed: allowed});
        emit StockSet(token, spotIndex, pxScale, allowed);
    }

    /// @notice Point the escrow valuation at a (new) HYPE/USDC spot market.
    function setHypeMarket(uint32 spotIndex, uint64 pxScale) external onlyOwner {
        require(pxScale > 0 && pxScale <= 1e8, "PR: scale");
        hypeSpotIndex = spotIndex;
        hypePxScale = pxScale;
        emit HypeMarketSet(spotIndex, pxScale);
    }

    /// @notice Withdraw ERC-20 inventory (or any stray token). Buyer escrow is
    ///         native HYPE and cannot be touched by this — the stock inventory
    ///         is protocol capital and stays recoverable at all times.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "PR: zero");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
