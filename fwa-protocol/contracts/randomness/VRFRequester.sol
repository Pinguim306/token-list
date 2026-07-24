// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CCIP, ICCIPRouterClient} from "./CCIPTypes.sol";

// Minimal local Chainlink VRF v2.5 types.
// PRODUCTION: inherit VRFConsumerBaseV2Plus and use VRFV2PlusClient from
// @chainlink/contracts; the coordinator address is per-chain (Arbitrum One).
library VRFV2Plus {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }
}

interface IVRFCoordinatorV2Plus {
    function requestRandomWords(VRFV2Plus.RandomWordsRequest calldata req) external returns (uint256 requestId);
}

/// @title VRFRequester (Arbitrum One side)
/// @notice Counterpart to CCIPVRFAdapter. Receives a randomness request from
///         RobinhoodChain over CCIP, draws Chainlink VRF v2.5 on Arbitrum One,
///         and relays the word back over CCIP.
///
/// @dev PRODUCTION notes:
///        - inherit CCIPReceiver (override _ccipReceive) and VRFConsumerBaseV2Plus
///          (override fulfillRandomWords) instead of the manual guards here;
///        - fund the VRF subscription and add this contract as a consumer;
///        - set requestConfirmations >= 3 and a callbackGasLimit that covers the
///          CCIP send in fulfillRandomWords.
contract VRFRequester is Ownable {
    ICCIPRouterClient public ccipRouter;
    IVRFCoordinatorV2Plus public coordinator;
    bytes32 public keyHash;
    uint256 public subId;
    uint16 public requestConfirmations = 3;
    uint32 public callbackGasLimit = 500_000;
    uint64 public srcChainSelector; // RobinhoodChain CCIP selector
    address public adapter; // CCIPVRFAdapter on RobinhoodChain
    address public feeToken; // address(0) => native ETH for the return CCIP leg

    mapping(uint256 => uint256) public vrfToRouterRequest; // vrfRequestId => routerRequestId

    event Configured(address ccipRouter, address coordinator, uint64 srcChainSelector, address adapter);
    event RequestForwarded(uint256 indexed routerRequestId, uint256 indexed vrfRequestId);
    event RandomnessRelayed(uint256 indexed routerRequestId, uint256 randomWord, bytes32 ccipMessageId);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function configure(
        ICCIPRouterClient ccipRouter_,
        IVRFCoordinatorV2Plus coordinator_,
        bytes32 keyHash_,
        uint256 subId_,
        uint64 srcChainSelector_,
        address adapter_,
        address feeToken_
    ) external onlyOwner {
        ccipRouter = ccipRouter_;
        coordinator = coordinator_;
        keyHash = keyHash_;
        subId = subId_;
        srcChainSelector = srcChainSelector_;
        adapter = adapter_;
        feeToken = feeToken_;
        emit Configured(address(ccipRouter_), address(coordinator_), srcChainSelector_, adapter_);
    }

    /// @notice Inbound CCIP request from RobinhoodChain -> draw VRF.
    function ccipReceive(CCIP.Any2EVMMessage calldata message) external {
        require(msg.sender == address(ccipRouter), "VRFR: only ccip router");
        require(message.sourceChainSelector == srcChainSelector, "VRFR: bad source");
        require(abi.decode(message.sender, (address)) == adapter, "VRFR: bad sender");

        uint256 routerRequestId = abi.decode(message.data, (uint256));
        uint256 vrfRequestId = coordinator.requestRandomWords(
            VRFV2Plus.RandomWordsRequest({
                keyHash: keyHash,
                subId: subId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: "" // PRODUCTION: VRFV2PlusClient._argsToBytes(ExtraArgsV1{nativePayment:true})
            })
        );
        vrfToRouterRequest[vrfRequestId] = routerRequestId;
        emit RequestForwarded(routerRequestId, vrfRequestId);
    }

    /// @notice VRF callback -> relay the word back to RobinhoodChain over CCIP.
    function fulfillRandomWords(uint256 vrfRequestId, uint256[] calldata randomWords) external {
        require(msg.sender == address(coordinator), "VRFR: only coordinator");
        uint256 routerRequestId = vrfToRouterRequest[vrfRequestId];
        require(routerRequestId != 0, "VRFR: unknown request");
        delete vrfToRouterRequest[vrfRequestId];

        CCIP.EVM2AnyMessage memory message = CCIP.EVM2AnyMessage({
            receiver: abi.encode(adapter),
            data: abi.encode(routerRequestId, randomWords[0]),
            tokenAmounts: new CCIP.EVMTokenAmount[](0),
            feeToken: feeToken,
            extraArgs: ""
        });
        uint256 fee = ccipRouter.getFee(srcChainSelector, message);
        bytes32 msgId = ccipRouter.ccipSend{value: feeToken == address(0) ? fee : 0}(srcChainSelector, message);
        emit RandomnessRelayed(routerRequestId, randomWords[0], msgId);
    }

    receive() external payable {}

    function rescueETH(address to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "VRFR: rescue failed");
    }
}
