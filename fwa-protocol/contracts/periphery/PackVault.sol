// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IBasketLike {
    function wrap(address[] calldata tokens, uint256[] calldata amounts) external returns (uint256 basketId);
    function unwrap(uint256 basketId, address to) external;
    function setApprovalForAll(address operator, bool approved) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IPoolLike {
    function deposit(address asset, uint256 tokenId, uint256 backing) external returns (uint256 id);
    function withdraw(uint256 id) external;
    function claimEarnings(uint256 id) external;
    function withdrawCredit() external;
    function activeCount() external view returns (uint256);
    function drawInFlight() external view returns (bool);
}

interface IEmitterLike {
    function harvest(uint256 positionId) external;
    function claim() external;
}

/// @title PackVault
/// @notice The operator's pack factory: holds an inventory of tokenized stocks
///         plus backing funds, and mints "packs" (EquityBasket + backing) into
///         the FWA pool — in bundles for launch seeding, and automatically via
///         a permissionless crank when the pool runs low.
///
/// @dev Two jobs, one contract, ZERO pool/basket changes:
///
///        LAUNCH SEEDING. `mintBundle(count)` wraps `count` identical packs
///        from a stored template (tokens + amounts + backing per pack) and
///        deposits each into the pool in a single transaction.
///
///        REPLENISHMENT. As buyers rip packs the pool depletes. Anyone may
///        call `replenishIfNeeded()`: when `pool.activeCount()` drops below
///        `floorCount` (and the cooldown has passed) the vault mints up to
///        `bundleSize` fresh packs from inventory. Automation is then just a
///        cron/bot calling a permissionless function — no privileged keys in
///        the hot path, and an empty inventory fails loudly instead of
///        silently minting nothing.
///
///      Deliberately NOT implemented: swapping protocol fees for stocks
///      on-chain. Auto-buying via a DEX inside the crank would add price
///      impact, sandwich/MEV exposure and an oracle dependency to a function
///      anyone can call. Instead the loop is operational: fees accrue to the
///      treasury -> operator buys stocks -> transfers them to this vault ->
///      the crank keeps the pool stocked. The vault is the automation half;
///      the fee-recycling half stays a human decision.
///
///      The vault OWNS the positions it creates (it is the depositor), so all
///      depositor rights — withdraw, earnings, credits, $FWA rewards — are
///      exposed as owner passthroughs.
contract PackVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BUNDLE = 50; // per-tx cap; a bundle is ~0.5M gas per pack

    IBasketLike public immutable basket;
    IPoolLike public immutable pool;
    IERC20 public immutable backingToken;
    address public emitter; // optional $FWA emitter for reward passthrough

    // ---- pack template (what one pack contains) ----
    address[] public templateTokens;
    uint256[] public templateAmounts;
    uint256 public backingPerPack;

    // ---- replenishment policy ----
    uint256 public floorCount; // crank fires when pool.activeCount() < floorCount
    uint256 public bundleSize; // packs per crank
    uint256 public cooldown; // seconds between cranks
    uint256 public lastReplenish;

    event TemplateSet(address[] tokens, uint256[] amounts, uint256 backingPerPack);
    event PolicySet(uint256 floorCount, uint256 bundleSize, uint256 cooldown);
    event BundleMinted(uint256 count, uint256 firstPositionId, address indexed caller);
    event EmitterSet(address emitter);

    constructor(IBasketLike basket_, IPoolLike pool_, IERC20 backingToken_, address initialOwner)
        Ownable(initialOwner)
    {
        require(
            address(basket_) != address(0) && address(pool_) != address(0) && address(backingToken_) != address(0),
            "PV: zero"
        );
        basket = basket_;
        pool = pool_;
        backingToken = backingToken_;
        // one-time standing approvals to the two trusted protocol contracts
        basket_.setApprovalForAll(address(pool_), true);
        backingToken_.forceApprove(address(pool_), type(uint256).max);
    }

    // ------------------------------------------------------------------ //
    //                           Configuration                            //
    // ------------------------------------------------------------------ //

    /// @notice Define what one pack contains. Tokens must be strictly
    ///         ascending (the basket's canonical-order rule). Re-setting the
    ///         template replaces it entirely and re-approves the new tokens.
    function setTemplate(address[] calldata tokens, uint256[] calldata amounts, uint256 backingPerPack_)
        external
        onlyOwner
    {
        require(tokens.length > 0 && tokens.length == amounts.length, "PV: bad template");
        require(backingPerPack_ > 0, "PV: backing=0");
        // Revoke standing approvals for tokens dropped from the previous
        // template so the vault never carries dangling max allowances.
        address[] memory old = templateTokens;
        for (uint256 i = 0; i < old.length; i++) {
            IERC20(old[i]).forceApprove(address(basket), 0);
        }
        address prev = address(0);
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] > prev, "PV: unsorted or duplicate");
            require(amounts[i] > 0, "PV: amount=0");
            // The backing token is consumed per pack separately (pool.deposit);
            // letting it double as a template leg would double-count inventory
            // in _affordablePacks. Forbid the overlap.
            require(tokens[i] != address(backingToken), "PV: backing in template");
            prev = tokens[i];
            IERC20(tokens[i]).forceApprove(address(basket), type(uint256).max);
        }
        templateTokens = tokens;
        templateAmounts = amounts;
        backingPerPack = backingPerPack_;
        emit TemplateSet(tokens, amounts, backingPerPack_);
    }

    /// @notice Tune the replenishment crank. floorCount 0 disables it.
    function setPolicy(uint256 floorCount_, uint256 bundleSize_, uint256 cooldown_) external onlyOwner {
        require(bundleSize_ > 0 && bundleSize_ <= MAX_BUNDLE, "PV: bundle size");
        floorCount = floorCount_;
        bundleSize = bundleSize_;
        cooldown = cooldown_;
        emit PolicySet(floorCount_, bundleSize_, cooldown_);
    }

    /// @notice Set (or clear) the $FWA emitter used by the reward passthroughs.
    function setEmitter(address emitter_) external onlyOwner {
        emitter = emitter_;
        emit EmitterSet(emitter_);
    }

    // ------------------------------------------------------------------ //
    //                         Pack minting paths                         //
    // ------------------------------------------------------------------ //

    /// @notice Launch seeding: mint `count` template packs into the pool in
    ///         one transaction. Owner-only — this spends vault inventory at
    ///         the owner's discretion, regardless of pool level.
    function mintBundle(uint256 count) external onlyOwner nonReentrant returns (uint256 firstPositionId) {
        firstPositionId = _mintPacks(count);
    }

    /// @notice Permissionless crank: refill the pool from inventory when it
    ///         runs below the configured floor. Bounded by bundleSize, the
    ///         cooldown, and — loudly — by what the inventory can afford.
    function replenishIfNeeded() external nonReentrant returns (uint256 minted) {
        require(floorCount > 0, "PV: crank disabled");
        require(!pool.drawInFlight(), "PV: draw in flight");
        uint256 active = pool.activeCount();
        require(active < floorCount, "PV: pool above floor");
        // The cooldown throttles shallow top-ups, but must never let a single
        // cheap 1-pack refill starve a later genuine deficit: once the pool has
        // drained past HALF its floor it's an emergency the crank always serves,
        // cooldown or not. So a griefer topping up a want=1 dip can consume the
        // cooldown, yet buyers can never be left stranded below floor/2.
        bool emergency = active * 2 < floorCount;
        require(emergency || block.timestamp >= lastReplenish + cooldown, "PV: cooldown");
        lastReplenish = block.timestamp;

        uint256 want = floorCount - active;
        if (want > bundleSize) want = bundleSize;
        uint256 can = _affordablePacks();
        minted = want < can ? want : can;
        require(minted > 0, "PV: inventory empty");
        _mintPacks(minted);
    }

    /// @notice How many template packs the current inventory can fund.
    function _affordablePacks() internal view returns (uint256 can) {
        if (templateTokens.length == 0 || backingPerPack == 0) return 0;
        can = backingToken.balanceOf(address(this)) / backingPerPack;
        for (uint256 i = 0; i < templateTokens.length; i++) {
            uint256 byToken = IERC20(templateTokens[i]).balanceOf(address(this)) / templateAmounts[i];
            if (byToken < can) can = byToken;
        }
    }

    function _mintPacks(uint256 count) internal returns (uint256 firstPositionId) {
        require(count > 0 && count <= MAX_BUNDLE, "PV: count");
        require(templateTokens.length > 0, "PV: no template");
        for (uint256 i = 0; i < count; i++) {
            uint256 basketId = basket.wrap(templateTokens, templateAmounts);
            uint256 positionId = pool.deposit(address(basket), basketId, backingPerPack);
            if (i == 0) firstPositionId = positionId;
        }
        emit BundleMinted(count, firstPositionId, msg.sender);
    }

    // ------------------------------------------------------------------ //
    //              Owner passthroughs (the vault IS the depositor)        //
    // ------------------------------------------------------------------ //

    /// @notice Close a vault-owned position: the basket returns to the vault,
    ///         backing + earnings accrue as pool credit (pull below).
    function withdrawPosition(uint256 id) external onlyOwner nonReentrant {
        pool.withdraw(id);
    }

    function claimEarnings(uint256 id) external onlyOwner nonReentrant {
        pool.claimEarnings(id);
    }

    /// @notice Pull the vault's accrued pool credit (earnings, refunds) into
    ///         the vault's backing inventory — where the crank can recycle it.
    function pullPoolCredit() external onlyOwner nonReentrant {
        pool.withdrawCredit();
    }

    function harvestRewards(uint256 positionId) external onlyOwner nonReentrant {
        require(emitter != address(0), "PV: no emitter");
        IEmitterLike(emitter).harvest(positionId);
    }

    function claimFwa() external onlyOwner nonReentrant {
        require(emitter != address(0), "PV: no emitter");
        IEmitterLike(emitter).claim();
    }

    /// @notice Unwrap a vault-held basket back into its stock tokens (they
    ///         land in the vault inventory).
    function unwrapBasket(uint256 basketId) external onlyOwner nonReentrant {
        basket.unwrap(basketId, address(this));
    }

    /// @notice Move any ERC-20 out of the vault (fees recycled, inventory
    ///         rotation, or full exit).
    function sweepToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Move a vault-held basket NFT out of the vault.
    function sweepBasket(uint256 basketId, address to) external onlyOwner nonReentrant {
        basket.transferFrom(address(this), to, basketId);
    }

    /// @notice Rescue any other ERC-721 accidentally sent here.
    function sweepNFT(address nft, uint256 tokenId, address to) external onlyOwner nonReentrant {
        IERC721(nft).transferFrom(address(this), to, tokenId);
    }
}
