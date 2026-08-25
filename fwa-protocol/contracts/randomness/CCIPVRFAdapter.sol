// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRandomnessAdapter, IRandomnessRouter} from "../interfaces/IRandomness.sol";
import {CCIP, ICCIPRouterClient} from "./CCIPTypes.sol";

/// @title CCIPVRFAdapter (RobinhoodChain side)
/// @notice Randomness adapter that sources Chainlink VRF v2.5 from Arbitrum One
///         (where VRF is live) and relays it back to RobinhoodChain over CCIP.
///
///         RobinhoodChain                         Arbitrum One
///         ─────────────                          ────────────
///         requestRandomness(reqId)
///            └─ ccipSend ─────────────▶  VRFRequester.ccipReceive
///                                          └─ requestRandomWords (VRF v2.5)
///                                          ◀─ fulfillRandomWords
///         ccipReceive  ◀───── ccipSend ──┘  (reqId, randomWord)
///            └─ router.fulfill(reqId, word)
///
/// @dev This is the "no new provider onboarding" path: CCIP is already live on
///      RobinhoodChain and VRF v2.5 is live on Arbitrum One. Fase 0 must measure
///      the round-trip latency (p50/p95) and per-draw cost on testnet before this
///      path is committed to. The native Pyth path exists in-tree as
///      `PythEntropyAdapter` — swap it in at the router with no pool changes.
contract CCIPVRFAdapter is IRandomnessAdapter, Ownable {
    IRandomnessRouter public immutable router;
    ICCIPRouterClient public ccipRouter;
    uint64 public destChainSelector; // Arbitrum One CCIP chain selector
    address public vrfRequester; // VRFRequester deployed on Arbitrum One
    address public feeToken; // address(0) => pay CCIP fees in native ETH

    mapping(uint256 => bool) public pending; // routerRequestId => outstanding

    event Configured(address ccipRouter, uint64 destChainSelector, address vrfRequester, address feeToken);
    event RandomnessRequested(uint256 indexed routerRequestId, bytes32 ccipMessageId);
    event RandomnessReturned(uint256 indexed routerRequestId, uint256 randomWord);

    constructor(address initialOwner, IRandomnessRouter router_) Ownable(initialOwner) {
        router = router_;
    }

    function configure(ICCIPRouterClient ccipRouter_, uint64 destChainSelector_, address vrfRequester_, address feeToken_)
        external
        onlyOwner
    {
        ccipRouter = ccipRouter_;
        destChainSelector = destChainSelector_;
        vrfRequester = vrfRequester_;
        feeToken = feeToken_;
        emit Configured(address(ccipRouter_), destChainSelector_, vrfRequester_, feeToken_);
    }

    /// @inheritdoc IRandomnessAdapter
    function requestRandomness(uint256 routerRequestId) external returns (bytes32 messageId) {
        require(msg.sender == address(router), "CVA: only router");
        require(vrfRequester != address(0), "CVA: not configured");
        pending[routerRequestId] = true;

        CCIP.EVM2AnyMessage memory message = CCIP.EVM2AnyMessage({
            receiver: abi.encode(vrfRequester),
            data: abi.encode(routerRequestId),
            tokenAmounts: new CCIP.EVMTokenAmount[](0),
            feeToken: feeToken,
            extraArgs: "" // PRODUCTION: Client._argsToBytes(EVMExtraArgsV2{gasLimit, allowOOOExecution})
        });

        uint256 fee = ccipRouter.getFee(destChainSelector, message);
        messageId = ccipRouter.ccipSend{value: feeToken == address(0) ? fee : 0}(destChainSelector, message);
        emit RandomnessRequested(routerRequestId, messageId);
    }

    /// @notice CCIP delivery of the VRF result from Arbitrum One.
    /// @dev PRODUCTION: inherit CCIPReceiver and override _ccipReceive; validate
    ///      message.sourceChainSelector == Arbitrum One and
    ///      abi.decode(message.sender) == vrfRequester.
    function ccipReceive(CCIP.Any2EVMMessage calldata message) external {
        require(msg.sender == address(ccipRouter), "CVA: only ccip router");
        require(message.sourceChainSelector == destChainSelector, "CVA: bad source");
        require(abi.decode(message.sender, (address)) == vrfRequester, "CVA: bad sender");

        (uint256 routerRequestId, uint256 randomWord) = abi.decode(message.data, (uint256, uint256));
        require(pending[routerRequestId], "CVA: not pending");
        pending[routerRequestId] = false;

        emit RandomnessReturned(routerRequestId, randomWord);
        router.fulfill(routerRequestId, randomWord);
    }

    /// @notice Fund the adapter with native ETH to pay CCIP request fees.
    receive() external payable {}

    function rescueETH(address to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "CVA: rescue failed");
    }
}
