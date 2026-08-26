// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Test doubles for the HyperCore read precompiles. In tests their
///      runtime code is copied onto the real precompile addresses
///      (hardhat_setCode), after which `setPx`/`setBbo` called ON the
///      precompile address write that address's own storage and the raw
///      32-byte reads (no selector, caught by the fallback) return them —
///      exactly the live call shape PackRip uses.
contract MockSpotPx {
    mapping(uint256 => uint256) internal px; // slot 0

    function setPx(uint32 index, uint64 value) external {
        px[index] = value;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        uint32 index = abi.decode(data, (uint32));
        return abi.encode(uint64(px[index]));
    }
}

contract MockBbo {
    mapping(uint256 => uint256) internal bid; // slot 0
    mapping(uint256 => uint256) internal ask; // slot 1

    function setBbo(uint32 asset, uint64 bid_, uint64 ask_) external {
        bid[asset] = bid_;
        ask[asset] = ask_;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        uint32 asset = abi.decode(data, (uint32));
        return abi.encode(uint64(bid[asset]), uint64(ask[asset]));
    }
}
