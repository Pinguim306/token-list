// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
/// @notice The on-chain pack checkout with a StockRip-style sell-back paid in
///         $HFWA. Buying a pack pays the flat price in native HYPE: the dev cut
///         goes straight to the treasury and the standing-bid share (85% by
///         default) is escrowed per buyer. The buyer then chooses, inside the
///         settlement window:
///           - `sellBack`: the escrow is market-bought into $HFWA through the
///             HFWA/WHYPE pair and delivered to the buyer — every sell-back is
///             buy pressure on the token, exactly the FWA/StockRip funnel
///             ("sell the NFT back ... in ETH, or as the FWA token").
///           - `keep`: the escrow is released to the treasury (the buyer keeps
///             the pack; the protocol keeps the full price).
///         After the window anyone may `finalize` a buyer — default Keep — so
///         escrow can never be stranded (mirrors FWAPool's finalize).
///
/// @dev The swap runs DIRECTLY against the V2 pair (wrap HYPE -> WHYPE,
///      transfer to pair, `swap` with the constant-product output at the
///      pair's 0.3% fee). The router's native-HYPE helpers proved unreliable
///      against HyperEVM's system WHYPE; the bare pair path was executed
///      live on chain 999. Buyer-supplied `minOut` gives slippage protection.
///
///      Batches merge: a new rip while packs are pending resets the single
///      per-buyer deadline (documented trade-off for O(1) storage). The owner
///      can retune price/bid/window for FUTURE rips; escrowed value is
///      untouchable by the owner except through the buyer's own settle or the
///      post-window default-Keep.
contract PackRip is Ownable, ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PACKS_PER_TX = 20;

    IERC20 public immutable hfwa;
    IWHYPE public immutable whype;
    IUniswapV2PairLike public immutable pair;
    bool private immutable hfwaIsToken0;

    address public treasury;
    uint256 public packPrice; // wei of native HYPE per pack
    uint256 public bidBps; // escrowed (sell-back) share of the price
    uint256 public settlementWindow; // seconds the buyer alone may settle

    struct Pending {
        uint128 packs;
        uint128 escrow; // total wei escrowed for those packs
        uint64 deadline; // last rip's timestamp + settlementWindow
    }

    mapping(address => Pending) public pending;

    event Ripped(address indexed buyer, uint256 packs, uint256 paid, uint256 escrowed, uint256 devCut);
    event SoldBack(address indexed buyer, uint256 packs, uint256 escrowSpent, uint256 hfwaOut);
    event Kept(address indexed buyer, uint256 packs, uint256 escrowReleased);
    event Finalized(address indexed buyer, uint256 packs, uint256 escrowReleased);
    event ParamsUpdated(uint256 packPrice, uint256 bidBps, uint256 settlementWindow);
    event TreasuryUpdated(address treasury);

    constructor(
        IERC20 hfwa_,
        IWHYPE whype_,
        IUniswapV2PairLike pair_,
        address treasury_,
        uint256 packPrice_,
        uint256 bidBps_,
        uint256 settlementWindow_,
        address initialOwner
    ) Ownable(initialOwner) {
        require(
            address(hfwa_) != address(0) && address(whype_) != address(0) && address(pair_) != address(0)
                && treasury_ != address(0),
            "PR: zero"
        );
        require(bidBps_ <= BPS && packPrice_ > 0, "PR: params");
        hfwa = hfwa_;
        whype = whype_;
        pair = pair_;
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

    /// @notice Keep `count` pending packs: their escrow goes to the treasury.
    function keep(uint256 count) external nonReentrant {
        uint256 escrowShare = _consume(msg.sender, count);
        (bool ok, ) = treasury.call{value: escrowShare}("");
        require(ok, "PR: treasury xfer");
        emit Kept(msg.sender, count, escrowShare);
    }

    /// @notice After a buyer's window closes, anyone may finalize the default
    ///         outcome (Keep) so escrow never sits forever.
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

    /// @notice Quote a sell-back: the escrow `count` packs would spend and the
    ///         HFWA the pair would currently return for it. The app reads this
    ///         to set a slippage floor before calling `sellBack`.
    function quoteSellBack(address buyer, uint256 count) external view returns (uint256 escrowShare, uint256 out) {
        Pending storage p = pending[buyer];
        require(count > 0 && count <= p.packs, "PR: count");
        escrowShare = count == p.packs ? p.escrow : (uint256(p.escrow) * count) / p.packs;
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = hfwaIsToken0 ? (uint256(r1), uint256(r0)) : (uint256(r0), uint256(r1));
        uint256 amountInWithFee = escrowShare * 997;
        out = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
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
}
