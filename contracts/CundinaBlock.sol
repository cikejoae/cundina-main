// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CundinaBlock
 * @dev Smart contract for each block in the Cundina Block platform
 */
contract CundinaBlock is Ownable, ReentrancyGuard {
    IERC20 public cundinaToken;
    
    uint256 public levelId;
    uint256 public requiredMembers;
    uint256 public contributionAmount;
    uint256 public totalCundina;
    
    address[] public members;
    mapping(address => bool) public isMember;
    mapping(address => uint256) public contributions;
    
    enum BlockStatus { Active, Completed, Distributed }
    BlockStatus public status;
    
    uint256 public createdAt;
    uint256 public completedAt;
    
    event MemberJoined(address indexed member, uint256 position);
    event BlockCompleted(uint256 completedAt);
    event FundsTransferredToCreator(address indexed creator, uint256 amount);
    
    constructor(
        address _cundinaToken,
        uint256 _levelId,
        uint256 _requiredMembers,
        uint256 _contributionAmount,
        uint256 _totalCundina,
        address _creator
    ) {
        cundinaToken = IERC20(_cundinaToken);
        levelId = _levelId;
        requiredMembers = _requiredMembers;
        contributionAmount = _contributionAmount;
        totalCundina = _totalCundina;
        status = BlockStatus.Active;
        createdAt = block.timestamp;
        
        // Creator must call joinBlock() to contribute like everyone else
        // This ensures proper token contribution and member count
        
        transferOwnership(_creator);
    }
    
    /**
     * @dev Join the block by contributing tokens
     */
    function joinBlock() external nonReentrant {
        require(status == BlockStatus.Active, "Block is not active");
        require(!isMember[msg.sender], "Already a member");
        require(members.length < requiredMembers, "Block is full");
        
        // Transfer tokens from sender to contract (accumulate in contract)
        require(
            cundinaToken.transferFrom(msg.sender, address(this), contributionAmount),
            "Token transfer failed"
        );
        
        // Add member
        members.push(msg.sender);
        isMember[msg.sender] = true;
        contributions[msg.sender] = contributionAmount;
        
        emit MemberJoined(msg.sender, members.length);
        
        // Check if block is complete
        if (members.length == requiredMembers) {
            status = BlockStatus.Completed;
            completedAt = block.timestamp;
            emit BlockCompleted(completedAt);
            // Note: Funds stay in contract until creator withdraws via withdrawToCreator()
        }
    }
    
    /**
     * @dev Withdraw all funds to the block creator (owner)
     * Only callable by owner when block is completed
     */
    function withdrawToCreator() external onlyOwner nonReentrant {
        require(status == BlockStatus.Completed, "Block not completed");
        
        uint256 contractBalance = cundinaToken.balanceOf(address(this));
        require(contractBalance > 0, "No funds to withdraw");
        
        address creator = owner();
        
        require(
            cundinaToken.transfer(creator, contractBalance),
            "Transfer to creator failed"
        );
        
        status = BlockStatus.Distributed;
        emit FundsTransferredToCreator(creator, contractBalance);
    }
    
    /**
     * @dev Get the current balance of tokens in the contract
     */
    function getContractBalance() external view returns (uint256) {
        return cundinaToken.balanceOf(address(this));
    }
    
    /**
     * @dev Get all members
     */
    function getMembers() external view returns (address[] memory) {
        return members;
    }
    
    /**
     * @dev Get block info
     */
    function getBlockInfo() external view returns (
        uint256 _levelId,
        uint256 _requiredMembers,
        uint256 _currentMembers,
        uint256 _contributionAmount,
        uint256 _totalCundina,
        BlockStatus _status,
        uint256 _createdAt,
        uint256 _completedAt
    ) {
        return (
            levelId,
            requiredMembers,
            members.length,
            contributionAmount,
            totalCundina,
            status,
            createdAt,
            completedAt
        );
    }
}
