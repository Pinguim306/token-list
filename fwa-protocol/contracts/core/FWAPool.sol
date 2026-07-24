// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {FenwickTree} from "../libraries/FenwickTree.sol";
import {IRandomnessRouter, IRandomnessConsumer} from "../interfaces/IRandomness.sol";
import {IFWAWhitelist} from "../interfaces/IFWAWhitelist.sol";
import {IFWAEmitter} from "../interfaces/IFWAEmitter.sol";

/// @title FWAPool
/// @notice Core Fake World Assets pool: ERC-721 positions backed by an ERC-20
///         stake become a Uniswap-V2-style pool that purchasers acquire at random.
///
/// @dev Security model (the lesson of the 2026-07-03 FWA exploit, in which state
///      was mutated between the VRF request and the callback so the draw landed on
///      the pool's most valuable NFT):
///
///        FREEZE-AT-REQUEST. When a draw starts we snapshot the total selection
///        weight and escrow the payment. While that draw is in flight the pool is
///        frozen: no deposits and no withdrawals can change the selection set. The
///        random word is applied to the frozen snapshot in a separate, permissionless
///        `settle` step; the randomness callback itself only stores the word and can
///        never revert or reorder. Draws are strictly serialized (one in flight at a
///        time), which makes the frozen-set guarantee trivial to reason about.
///
///      This is deliberately conservative. Higher draw throughput (append-only
///      deposits during flight, per-draw tree snapshots) is a documented future
///      optimization, not an MVP requirement.
contract FWAPool is IRandomnessConsumer, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using FenwickTree for FenwickTree.Tree;

    // --------------------------------------------------------------------- //
    //                               Constants                               //
    // --------------------------------------------------------------------- //

    uint256 public constant BPS = 10_000;
    /// @dev Selection weight is inversely proportional to backing: weight = 1e36 / backing.
    uint256 public constant INVERSE_WEIGHT_NUMERATOR = 1e36;
    uint256 private constant ACC_PRECISION = 1e18;

    // --------------------------------------------------------------------- //
    //                             Configuration                             //
    // --------------------------------------------------------------------- //

    IERC20 public immutable backingToken;
    IRandomnessRouter public immutable router;
    IFWAWhitelist public immutable whitelist;
    address public feeRouter;
    /// @notice Optional $FWA emissions sink. Notified via guarded (try/catch)
    ///         hooks so it can never revert or brick pool operations.
    address public emitter;

    // Crown (top-deposit) reward. Exactly one active position holds the crown and
    // accrues a tithe (topShareBps of each acquisition fee), paid out when it exits
    // or is dethroned. A challenger must exceed the incumbent's backing by
    // topThresholdBps. While the crown is vacant, the tithe reverts to the equal
    // per-position split. Crown bookkeeping never touches selection weights, so it
    // is orthogonal to freeze-at-request.
    uint256 public topListingId; // active position holding the crown; 0 = vacant
    uint256 public topBacking; // its backing (challenge reference)
    uint256 public topPot; // accrued tithe (backing token)
    uint256 public topShareBps = 500; // 5% of each acquisition fee -> tithe
    uint256 public topThresholdBps = 1_000; // challenger must exceed incumbent by 10%

    uint256 public surchargeBps = 1_000; // 10% acquisition surcharge over EV
    uint256 public acquisitionCutBps = 2_000; // protocol cut of the acquisition fee
    uint256 public settlementFeeBps = 100; // 1% of backing when purchaser keeps the NFT
    uint256 public bidBps = 8_500; // standing bid = 85% of backing
    uint256 public settlementWindow = 24 hours; // purchaser-only decision window
    uint256 public requestTimeout = 1 hours; // randomness liveness deadline

    // --------------------------------------------------------------------- //
    //                               Positions                               //
    // --------------------------------------------------------------------- //

    struct Position {
        address depositor;
        address asset;
        uint256 tokenId;
        uint256 backing;
        uint256 weight;
        bool active;
        uint256 feeDebt; // accFeePerPosition snapshot at (re)entry
    }

    mapping(uint256 => Position) public positions; // id == Fenwick leaf index
    uint256 public positionCount; // total ever created
    uint256 public activeCount;
    uint256 public weightedBackingTotal; // sum(weight * backing) over active positions
    uint256 public accFeePerPosition; // scaled by ACC_PRECISION
    FenwickTree.Tree private tree;

    // --------------------------------------------------------------------- //
    //                                 Draws                                 //
    // --------------------------------------------------------------------- //

    enum DrawState {
        None,
        Requested,
        Fulfilled,
        Settled,
        Refunded
    }

    enum Choice {
        Keep,
        SellBack
    }

    struct Draw {
        address buyer;
        uint256 price;
        uint256 totalWeightSnapshot;
        uint256 randomWord;
        uint256 requestedAt;
        uint256 fulfilledAt;
        uint256 selectedId;
        DrawState state;
    }

    mapping(uint256 => Draw) public draws;
    uint256 public drawCount;
    bool public drawInFlight;
    uint256 public currentDrawId;

    /// @notice Pull-based withdrawable balances (earnings, refunds, payouts, protocol fees).
    mapping(address => uint256) public backingCredit;

    /// @notice keccak256(asset, tokenId) => rightful recipient of an NFT whose
    ///         settlement transfer reverted and was escrowed for later claim.
    mapping(bytes32 => address) public nftClaims;

    // --------------------------------------------------------------------- //
    //                                 Events                                //
    // --------------------------------------------------------------------- //

    event Deposited(uint256 indexed id, address indexed depositor, address indexed asset, uint256 tokenId, uint256 backing, uint256 weight);
    event Withdrawn(uint256 indexed id, address indexed depositor);
    event EarningsClaimed(uint256 indexed id, address indexed depositor, uint256 amount);
    event DrawStarted(uint256 indexed drawId, address indexed buyer, uint256 price, uint256 totalWeightSnapshot);
    event DrawFulfilled(uint256 indexed drawId, uint256 randomWord);
    event DrawSettled(uint256 indexed drawId, uint256 indexed selectedId, uint8 choice);
    event DrawRefunded(uint256 indexed drawId, address indexed buyer, uint256 amount);
    event StaleFulfillment(uint256 indexed drawId);
    event CreditWithdrawn(address indexed account, uint256 amount);
    event NFTEscrowed(address indexed asset, uint256 indexed tokenId, address indexed to);
    event StuckNFTClaimed(address indexed asset, uint256 indexed tokenId, address indexed to);
    event EmitterUpdated(address indexed emitter);
    event CrownClaimed(uint256 indexed id, uint256 backing);
    event CrownDethroned(uint256 indexed oldId, uint256 indexed newId, uint256 potPaid);
    event CrownVacated(uint256 indexed id, uint256 potPaid);
    event CrownParamsUpdated(uint256 topShareBps, uint256 topThresholdBps);
    event ParamsUpdated();

    constructor(
        IERC20 backingToken_,
        IRandomnessRouter router_,
        IFWAWhitelist whitelist_,
        address feeRouter_,
        address initialOwner
    ) Ownable(initialOwner) {
        require(
            address(backingToken_) != address(0) && address(router_) != address(0) && address(whitelist_) != address(0) && feeRouter_ != address(0),
            "FWA: zero"
        );
        backingToken = backingToken_;
        router = router_;
        whitelist = whitelist_;
        feeRouter = feeRouter_;
    }

    // --------------------------------------------------------------------- //
    //                               Deposits                                //
    // --------------------------------------------------------------------- //

    /// @notice Lock an ERC-721 plus ERC-20 backing to create a position.
    function deposit(address asset, uint256 tokenId, uint256 backing) external nonReentrant returns (uint256 id) {
        require(!drawInFlight, "FWA: draw in flight");
        require(backing > 0, "FWA: backing=0");
        require(whitelist.isAllowed(asset), "FWA: asset not allowed");

        uint256 weight = INVERSE_WEIGHT_NUMERATOR / backing;
        require(weight > 0, "FWA: backing too large");

        IERC721(asset).transferFrom(msg.sender, address(this), tokenId);
        backingToken.safeTransferFrom(msg.sender, address(this), backing);

        id = ++positionCount;
        positions[id] = Position({
            depositor: msg.sender,
            asset: asset,
            tokenId: tokenId,
            backing: backing,
            weight: weight,
            active: true,
            feeDebt: accFeePerPosition
        });
        activeCount += 1;
        weightedBackingTotal += weight * backing;
        tree.update(id, int256(weight));

        emit Deposited(id, msg.sender, asset, tokenId, backing, weight);
        _claimTopSpot(id); // auto-challenge the crown (no-op unless vacant or beats threshold)
        _notifyDeposit(id, msg.sender, backing);
    }

    /// @notice Depositor voluntarily closes an active position, reclaiming the NFT,
    ///         the backing stake, and any accrued fee earnings.
    function withdraw(uint256 id) external nonReentrant {
        require(!drawInFlight, "FWA: draw in flight");
        Position storage p = positions[id];
        require(p.active && p.depositor == msg.sender, "FWA: not owner");

        _payEarnings(id);
        backingCredit[p.depositor] += p.backing;
        address asset = p.asset;
        uint256 tokenId = p.tokenId;
        address depositor = p.depositor;
        _deactivate(id);

        IERC721(asset).transferFrom(address(this), depositor, tokenId);
        emit Withdrawn(id, depositor);
        _notifyClose(id);
    }

    /// @notice Claim accrued fee earnings for an active position without closing it.
    function claimEarnings(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        require(p.active && p.depositor == msg.sender, "FWA: not owner");
        uint256 paid = _payEarnings(id);
        emit EarningsClaimed(id, msg.sender, paid);
    }

    // --------------------------------------------------------------------- //
    //                                 Draws                                 //
    // --------------------------------------------------------------------- //

    /// @notice Current acquisition price = EV (harmonic mean of backings) * (1 + surcharge).
    function acquisitionPrice() public view returns (uint256) {
        uint256 tw = tree.total;
        if (tw == 0) return 0;
        uint256 ev = weightedBackingTotal / tw;
        return (ev * (BPS + surchargeBps)) / BPS;
    }

    /// @notice Start a draw: escrow payment, snapshot the frozen selection set, and
    ///         request one random word. Reverts if a draw is already in flight.
    function startDraw(uint256 maxPrice) external nonReentrant returns (uint256 drawId) {
        require(!drawInFlight, "FWA: draw in flight");
        require(activeCount > 0, "FWA: empty pool");

        uint256 price = acquisitionPrice();
        require(price <= maxPrice, "FWA: slippage");

        backingToken.safeTransferFrom(msg.sender, address(this), price);

        drawId = ++drawCount;
        uint256 tw = tree.total;
        draws[drawId] = Draw({
            buyer: msg.sender,
            price: price,
            totalWeightSnapshot: tw,
            randomWord: 0,
            requestedAt: block.timestamp,
            fulfilledAt: 0,
            selectedId: 0,
            state: DrawState.Requested
        });
        drawInFlight = true;
        currentDrawId = drawId;

        emit DrawStarted(drawId, msg.sender, price, tw);
        router.requestRandom(drawId);
    }

    /// @inheritdoc IRandomnessConsumer
    /// @dev Minimal, resilient callback: stores the word only, never reverts on a
    ///      stale/expired draw, never performs selection or transfers.
    function fulfillRandomness(uint256 drawId, uint256 randomWord) external {
        require(msg.sender == address(router), "FWA: only router");
        Draw storage d = draws[drawId];
        if (d.state != DrawState.Requested) {
            emit StaleFulfillment(drawId);
            return;
        }
        d.randomWord = randomWord;
        d.fulfilledAt = block.timestamp;
        d.state = DrawState.Fulfilled;
        emit DrawFulfilled(drawId, randomWord);
    }

    /// @notice Purchaser resolves their draw within the settlement window.
    function settle(uint256 drawId, Choice choice) external nonReentrant {
        Draw storage d = draws[drawId];
        require(d.state == DrawState.Fulfilled, "FWA: not fulfilled");
        require(msg.sender == d.buyer, "FWA: only buyer");
        require(block.timestamp <= d.fulfilledAt + settlementWindow, "FWA: window passed");
        _settle(drawId, choice);
    }

    /// @notice After the purchaser window closes, anyone can finalize the default
    ///         outcome (Keep) so nothing locks.
    function finalize(uint256 drawId) external nonReentrant {
        Draw storage d = draws[drawId];
        require(d.state == DrawState.Fulfilled, "FWA: not fulfilled");
        require(block.timestamp > d.fulfilledAt + settlementWindow, "FWA: too early");
        _settle(drawId, Choice.Keep);
    }

    /// @notice If randomness is not delivered before the deadline, refund the
    ///         purchaser's escrowed fee and clear the in-flight lock.
    function expireDraw(uint256 drawId) external nonReentrant {
        Draw storage d = draws[drawId];
        require(d.state == DrawState.Requested, "FWA: not pending");
        require(block.timestamp > d.requestedAt + requestTimeout, "FWA: not expired");
        d.state = DrawState.Refunded;
        backingCredit[d.buyer] += d.price;
        drawInFlight = false;
        emit DrawRefunded(drawId, d.buyer, d.price);
    }

    function _settle(uint256 drawId, Choice choice) internal {
        Draw storage d = draws[drawId];

        // Select a position deterministically from the FROZEN snapshot.
        uint256 target = d.randomWord % d.totalWeightSnapshot;
        uint256 id = tree.findByPrefix(target);
        Position storage p = positions[id];
        require(p.active, "FWA: inactive selection"); // guaranteed by freeze-at-request
        d.selectedId = id;

        // Distribute the acquisition fee: protocol cut + crown tithe + equal split.
        _settleFee(d.price);

        address buyer = d.buyer;
        address depositor = p.depositor;
        address asset = p.asset;
        uint256 tokenId = p.tokenId;
        uint256 backing = p.backing;

        _payEarnings(id); // realize the selected position's own fee earnings

        address nftTo;
        if (choice == Choice.Keep) {
            uint256 keepFee = (backing * settlementFeeBps) / BPS;
            backingCredit[feeRouter] += keepFee;
            backingCredit[depositor] += backing - keepFee;
            nftTo = buyer;
        } else {
            uint256 bid = (backing * bidBps) / BPS;
            backingCredit[buyer] += bid;
            backingCredit[feeRouter] += backing - bid; // retained settlement discount
            nftTo = depositor;
        }
        _deactivate(id);

        // Effects before interaction: ALWAYS release the in-flight lock and close
        // the draw. Combined with the non-reverting delivery below, a misbehaving
        // collection (pausable / blocklisted / malicious) can never wedge the pool.
        d.state = DrawState.Settled;
        drawInFlight = false;
        emit DrawSettled(drawId, id, uint8(choice));

        _deliver(asset, nftTo, tokenId);
        _notifyClose(id); // selected position left the pool
        _notifyPurchase(buyer); // reward the purchaser
    }

    // --------------------------------------------------------------------- //
    //                      Emitter hooks (guarded)                          //
    // --------------------------------------------------------------------- //

    function _notifyDeposit(uint256 id, address depositor, uint256 backing) internal {
        address e = emitter;
        if (e == address(0)) return;
        try IFWAEmitter(e).onDeposit(id, depositor, backing) {} catch {}
    }

    function _notifyClose(uint256 id) internal {
        address e = emitter;
        if (e == address(0)) return;
        try IFWAEmitter(e).onClose(id) {} catch {}
    }

    function _notifyPurchase(address buyer) internal {
        address e = emitter;
        if (e == address(0)) return;
        try IFWAEmitter(e).onPurchase(buyer) {} catch {}
    }

    /// @dev Non-reverting NFT delivery. If the collection reverts the transfer,
    ///      the NFT is escrowed for a pull-based claim instead of bricking the pool.
    function _deliver(address asset, address to, uint256 tokenId) internal {
        try IERC721(asset).transferFrom(address(this), to, tokenId) {
            // delivered
        } catch {
            nftClaims[keccak256(abi.encodePacked(asset, tokenId))] = to;
            emit NFTEscrowed(asset, tokenId, to);
        }
    }

    /// @notice Retrieve an NFT that could not be delivered at settlement time
    ///         (e.g. the collection was paused). Callable once transfers work again.
    function claimStuckNFT(address asset, uint256 tokenId) external nonReentrant {
        bytes32 k = keccak256(abi.encodePacked(asset, tokenId));
        address to = nftClaims[k];
        require(to == msg.sender, "FWA: not claimant");
        delete nftClaims[k];
        IERC721(asset).transferFrom(address(this), msg.sender, tokenId);
        emit StuckNFTClaimed(asset, tokenId, msg.sender);
    }

    // --------------------------------------------------------------------- //
    //                                Credits                                //
    // --------------------------------------------------------------------- //

    /// @notice Pull-based withdrawal of all accrued backing-token credit.
    function withdrawCredit() external nonReentrant {
        uint256 amt = backingCredit[msg.sender];
        require(amt > 0, "FWA: no credit");
        backingCredit[msg.sender] = 0;
        backingToken.safeTransfer(msg.sender, amt);
        emit CreditWithdrawn(msg.sender, amt);
    }

    // --------------------------------------------------------------------- //
    //                               Internals                               //
    // --------------------------------------------------------------------- //

    /// @dev Splits an acquisition fee: protocol cut, then crown tithe (if the
    ///      crown is occupied), then the equal per-position remainder.
    function _settleFee(uint256 price) internal {
        uint256 protocolCut = (price * acquisitionCutBps) / BPS;
        if (protocolCut > 0) backingCredit[feeRouter] += protocolCut;
        uint256 distributable = price - protocolCut;
        if (topListingId != 0 && topShareBps > 0) {
            uint256 tithe = (distributable * topShareBps) / BPS;
            if (tithe > 0) {
                topPot += tithe;
                distributable -= tithe;
            }
        }
        _distributeFee(distributable);
    }

    function _distributeFee(uint256 amount) internal {
        if (amount == 0) return;
        if (activeCount == 0) {
            backingCredit[feeRouter] += amount;
            return;
        }
        // The sub-wei fractional remainder ((amount * ACC_PRECISION) % activeCount)
        // stays inside accFeePerPosition and is paid out via carry on future claims,
        // or harmlessly stranded (always the solvent direction). It is NOT also
        // credited to the protocol — doing so double-counts it and can, over many
        // distributions, credit more than `amount` in aggregate.
        accFeePerPosition += (amount * ACC_PRECISION) / activeCount;
    }

    function _payEarnings(uint256 id) internal returns (uint256 pending) {
        Position storage p = positions[id];
        pending = ((accFeePerPosition - p.feeDebt)) / ACC_PRECISION;
        p.feeDebt = accFeePerPosition;
        if (pending > 0) backingCredit[p.depositor] += pending;
    }

    function _deactivate(uint256 id) internal {
        Position storage p = positions[id];
        // Crown exit: the departing crown holder collects the accrued tithe pot.
        if (id == topListingId) {
            uint256 pot = topPot;
            topPot = 0;
            topListingId = 0;
            topBacking = 0;
            if (pot > 0) backingCredit[p.depositor] += pot;
            emit CrownVacated(id, pot);
        }
        p.active = false;
        activeCount -= 1;
        weightedBackingTotal -= p.weight * p.backing;
        tree.update(id, -int256(p.weight));
    }

    /// @notice Claim the crown for an active position — when vacant, or by
    ///         exceeding the incumbent's backing by topThresholdBps.
    function claimTopSpot(uint256 id) external nonReentrant {
        require(!drawInFlight, "FWA: draw in flight");
        Position storage p = positions[id];
        require(p.active, "FWA: inactive");
        require(
            topListingId == 0 || (id != topListingId && p.backing * BPS >= topBacking * (BPS + topThresholdBps)),
            "FWA: cannot claim crown"
        );
        _claimTopSpot(id);
    }

    /// @dev Internal crown transfer; no-ops if the position is already the crown
    ///      or does not beat the threshold. Pays the dethroned incumbent its pot.
    function _claimTopSpot(uint256 id) internal {
        Position storage p = positions[id];
        if (topListingId == 0) {
            topListingId = id;
            topBacking = p.backing;
            emit CrownClaimed(id, p.backing);
        } else if (id != topListingId && p.backing * BPS >= topBacking * (BPS + topThresholdBps)) {
            uint256 pot = topPot;
            topPot = 0;
            if (pot > 0) backingCredit[positions[topListingId].depositor] += pot;
            emit CrownDethroned(topListingId, id, pot);
            topListingId = id;
            topBacking = p.backing;
        }
    }

    // --------------------------------------------------------------------- //
    //                                 Views                                 //
    // --------------------------------------------------------------------- //

    function totalWeight() external view returns (uint256) {
        return tree.total;
    }

    /// @notice On-chain selection odds for a position, in basis points of totalWeight.
    function selectionOddsBps(uint256 id) external view returns (uint256) {
        uint256 tw = tree.total;
        if (tw == 0 || !positions[id].active) return 0;
        return (positions[id].weight * BPS) / tw;
    }

    // --------------------------------------------------------------------- //
    //                                 Admin                                 //
    // --------------------------------------------------------------------- //

    function setParams(
        uint256 surchargeBps_,
        uint256 acquisitionCutBps_,
        uint256 settlementFeeBps_,
        uint256 bidBps_,
        uint256 settlementWindow_,
        uint256 requestTimeout_
    ) external onlyOwner {
        require(acquisitionCutBps_ <= BPS && settlementFeeBps_ <= BPS && bidBps_ <= BPS, "FWA: bps");
        surchargeBps = surchargeBps_;
        acquisitionCutBps = acquisitionCutBps_;
        settlementFeeBps = settlementFeeBps_;
        bidBps = bidBps_;
        settlementWindow = settlementWindow_;
        requestTimeout = requestTimeout_;
        emit ParamsUpdated();
    }

    function setFeeRouter(address feeRouter_) external onlyOwner {
        require(feeRouter_ != address(0), "FWA: zero");
        feeRouter = feeRouter_;
    }

    /// @notice Set (or clear, with address(0)) the $FWA emissions sink.
    function setEmitter(address emitter_) external onlyOwner {
        emitter = emitter_;
        emit EmitterUpdated(emitter_);
    }

    /// @notice Tune the crown tithe share and challenge threshold.
    function setCrownParams(uint256 topShareBps_, uint256 topThresholdBps_) external onlyOwner {
        require(topShareBps_ <= BPS, "FWA: bps");
        topShareBps = topShareBps_;
        topThresholdBps = topThresholdBps_;
        emit CrownParamsUpdated(topShareBps_, topThresholdBps_);
    }
}
