// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal local CCIP types shared by the RobinhoodChain adapter and the
// Arbitrum One requester. PRODUCTION: replace with the canonical Chainlink
// imports (@chainlink/contracts-ccip Client / IRouterClient / CCIPReceiver).
library CCIP {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }
    struct EVM2AnyMessage {
        bytes receiver;
        bytes data;
        EVMTokenAmount[] tokenAmounts;
        address feeToken;
        bytes extraArgs;
    }
    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender;
        bytes data;
        EVMTokenAmount[] destTokenAmounts;
    }
}

interface ICCIPRouterClient {
    function getFee(uint64 destChainSelector, CCIP.EVM2AnyMessage calldata message) external view returns (uint256);
    function ccipSend(uint64 destChainSelector, CCIP.EVM2AnyMessage calldata message) external payable returns (bytes32);
}
