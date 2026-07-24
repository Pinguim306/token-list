// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title FWAClaim
/// @notice Merkle-gated distribution of $FWA (e.g. the 20% snapshot allocation).
///         Standard index/account/amount leaves with a claimed bitmap. Pre-fund
///         this contract with the FWA to be distributed.
contract FWAClaim is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable fwa;
    bytes32 public merkleRoot;
    mapping(uint256 => uint256) private claimedBitMap;

    event Claimed(uint256 index, address indexed account, uint256 amount);
    event MerkleRootUpdated(bytes32 root);
    event Swept(address indexed to, uint256 amount);

    constructor(IERC20 fwa_, bytes32 merkleRoot_, address initialOwner) Ownable(initialOwner) {
        require(address(fwa_) != address(0), "FWAClaim: zero");
        fwa = fwa_;
        merkleRoot = merkleRoot_;
    }

    function setMerkleRoot(bytes32 merkleRoot_) external onlyOwner {
        merkleRoot = merkleRoot_;
        emit MerkleRootUpdated(merkleRoot_);
    }

    function isClaimed(uint256 index) public view returns (bool) {
        uint256 word = index / 256;
        uint256 bit = index % 256;
        return (claimedBitMap[word] & (1 << bit)) != 0;
    }

    function _setClaimed(uint256 index) private {
        uint256 word = index / 256;
        uint256 bit = index % 256;
        claimedBitMap[word] |= (1 << bit);
    }

    function claim(uint256 index, address account, uint256 amount, bytes32[] calldata proof) external {
        require(!isClaimed(index), "FWAClaim: already claimed");
        bytes32 leaf = keccak256(abi.encodePacked(index, account, amount));
        require(MerkleProof.verify(proof, merkleRoot, leaf), "FWAClaim: invalid proof");
        _setClaimed(index);
        fwa.safeTransfer(account, amount);
        emit Claimed(index, account, amount);
    }

    /// @notice Recover unclaimed FWA after the distribution window (owner only).
    function sweep(address to, uint256 amount) external onlyOwner {
        fwa.safeTransfer(to, amount);
        emit Swept(to, amount);
    }
}
