// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFWAEmitter} from "../interfaces/IFWAEmitter.sol";

/// @title FWAEmitter
/// @notice $FWA emissions, MasterChef-style. Depositor rewards accrue on
///         shares = sqrt(backing) at a fixed per-second rate over an emission
///         window; purchasers get a fixed reward per acquisition within the
///         window. Pre-fund this contract with the $FWA to be emitted.
///
/// @dev The pool calls the on* hooks wrapped in try/catch. This contract is
///      therefore written to never need to revert the pool: hooks no-op on
///      out-of-range/zero cases rather than reverting. Rewards are pull-based
///      via claim().
///
///      The two reward streams are SEGREGATED so they cannot cannibalize each
///      other. Depositor emissions are bounded by depositorRatePerSec*(end-start);
///      purchaser rewards are bounded by an explicit `purchaserBudget` that the
///      owner funds and that `onPurchase` decrements (skipping once exhausted).
///      Fund the contract with at least (depositor emission cap + purchaserBudget)
///      $FWA so no legitimately-accrued reward is ever stranded.
///
///      Simplification vs. the original FWA: purchaser rewards are a fixed
///      per-acquisition amount instead of a pro-rata daily pot. Documented as a
///      deliberate MVP choice; the daily-pot variant is future work.
contract FWAEmitter is IFWAEmitter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable fwa;
    address public pool;

    uint256 private constant PRECISION = 1e18;

    // Emission window.
    uint256 public startTime;
    uint256 public endTime;

    // Depositor side (shares = sqrt(backing)).
    uint256 public depositorRatePerSec;
    uint256 public accRewardPerShare; // scaled by PRECISION
    uint256 public lastUpdate;
    uint256 public totalShares;

    struct Stake {
        address owner;
        uint256 shares;
        uint256 rewardDebt;
    }

    mapping(uint256 => Stake) public stakes; // positionId => stake

    // Purchaser side.
    uint256 public purchaserRewardPerAcq;
    /// @notice $FWA reserved for purchaser rewards. Decremented per acquisition;
    ///         once exhausted, onPurchase no-ops so it can never eat into the
    ///         depositor emission allocation.
    uint256 public purchaserBudget;

    mapping(address => uint256) public rewardCredit; // claimable $FWA

    event PoolUpdated(address indexed pool);
    event Configured(uint256 startTime, uint256 endTime, uint256 depositorRatePerSec, uint256 purchaserRewardPerAcq);
    event PurchaserBudgetSet(uint256 amount);
    event Staked(uint256 indexed positionId, address indexed owner, uint256 shares);
    event Unstaked(uint256 indexed positionId, address indexed owner, uint256 pending);
    event Harvested(uint256 indexed positionId, address indexed owner, uint256 pending);
    event PurchaserRewarded(address indexed buyer, uint256 amount);
    event Claimed(address indexed account, uint256 amount);

    modifier onlyPool() {
        require(msg.sender == pool, "EM: only pool");
        _;
    }

    constructor(IERC20 fwa_, address initialOwner) Ownable(initialOwner) {
        require(address(fwa_) != address(0), "EM: zero");
        fwa = fwa_;
    }

    function setPool(address pool_) external onlyOwner {
        pool = pool_;
        emit PoolUpdated(pool_);
    }

    function configure(uint256 startTime_, uint256 endTime_, uint256 depositorRatePerSec_, uint256 purchaserRewardPerAcq_)
        external
        onlyOwner
    {
        require(endTime_ > startTime_, "EM: window");
        startTime = startTime_;
        endTime = endTime_;
        depositorRatePerSec = depositorRatePerSec_;
        purchaserRewardPerAcq = purchaserRewardPerAcq_;
        lastUpdate = startTime_;
        emit Configured(startTime_, endTime_, depositorRatePerSec_, purchaserRewardPerAcq_);
    }

    /// @notice Reserve $FWA for purchaser rewards. The owner is responsible for
    ///         funding the contract with at least this amount on top of the
    ///         depositor emission cap.
    function setPurchaserBudget(uint256 amount) external onlyOwner {
        purchaserBudget = amount;
        emit PurchaserBudgetSet(amount);
    }

    function _accrue() internal {
        uint256 nowClamped = block.timestamp < endTime ? block.timestamp : endTime;
        if (nowClamped <= lastUpdate) return;
        if (totalShares > 0) {
            uint256 elapsed = nowClamped - lastUpdate;
            accRewardPerShare += (elapsed * depositorRatePerSec * PRECISION) / totalShares;
        }
        lastUpdate = nowClamped;
    }

    /// @inheritdoc IFWAEmitter
    function onDeposit(uint256 positionId, address depositor, uint256 backing) external onlyPool {
        _accrue();
        uint256 shares = Math.sqrt(backing);
        if (shares == 0) return;
        stakes[positionId] = Stake({owner: depositor, shares: shares, rewardDebt: (shares * accRewardPerShare) / PRECISION});
        totalShares += shares;
        emit Staked(positionId, depositor, shares);
    }

    /// @inheritdoc IFWAEmitter
    function onClose(uint256 positionId) external onlyPool {
        _accrue();
        Stake memory s = stakes[positionId];
        if (s.shares == 0) return;
        uint256 pending = (s.shares * accRewardPerShare) / PRECISION - s.rewardDebt;
        if (pending > 0) rewardCredit[s.owner] += pending;
        totalShares -= s.shares;
        delete stakes[positionId];
        emit Unstaked(positionId, s.owner, pending);
    }

    /// @inheritdoc IFWAEmitter
    function onPurchase(address buyer) external onlyPool {
        if (block.timestamp < startTime || block.timestamp > endTime) return;
        uint256 r = purchaserRewardPerAcq;
        // Bounded by the reserved purchaser budget; skip once exhausted so
        // purchaser rewards can never strand depositor emissions. Safe to no-op
        // because the pool wraps this hook in try/catch.
        if (r == 0 || purchaserBudget < r) return;
        purchaserBudget -= r;
        rewardCredit[buyer] += r;
        emit PurchaserRewarded(buyer, r);
    }

    /// @notice Realize a position's pending depositor rewards without closing it.
    function harvest(uint256 positionId) external {
        _accrue();
        Stake storage s = stakes[positionId];
        require(s.owner == msg.sender, "EM: not owner");
        uint256 acc = (s.shares * accRewardPerShare) / PRECISION;
        uint256 pending = acc - s.rewardDebt;
        s.rewardDebt = acc;
        if (pending > 0) rewardCredit[msg.sender] += pending;
        emit Harvested(positionId, msg.sender, pending);
    }

    /// @notice Pull accrued $FWA rewards.
    function claim() external {
        uint256 amt = rewardCredit[msg.sender];
        require(amt > 0, "EM: nothing");
        rewardCredit[msg.sender] = 0;
        fwa.safeTransfer(msg.sender, amt);
        emit Claimed(msg.sender, amt);
    }

    /// @notice Pending depositor rewards for a position (view helper).
    function pendingOf(uint256 positionId) external view returns (uint256) {
        Stake memory s = stakes[positionId];
        if (s.shares == 0) return 0;
        uint256 acc = accRewardPerShare;
        uint256 nowClamped = block.timestamp < endTime ? block.timestamp : endTime;
        if (nowClamped > lastUpdate && totalShares > 0) {
            acc += ((nowClamped - lastUpdate) * depositorRatePerSec * PRECISION) / totalShares;
        }
        return (s.shares * acc) / PRECISION - s.rewardDebt;
    }
}
