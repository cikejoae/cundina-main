// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CundinaBlockSecure is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable cundinaToken;

    uint256 public immutable levelId;
    uint256 public immutable requiredMembers;
    uint256 public immutable contributionAmount;
    uint256 public immutable totalCundina;

    address[] public members;
    mapping(address => bool) public isMember;
    mapping(address => uint256) public contributions;

    enum BlockStatus { Active, Completed, Distributed }
    BlockStatus public status;

    uint256 public immutable createdAt;
    uint256 public completedAt;

    event MemberJoined(address indexed member, uint256 indexed position, uint256 amount);
    event BlockCompleted(uint256 completedAt);
    event FundsTransferredToCreator(address indexed creator, uint256 amount);

    constructor(
        address _cundinaToken,
        uint256 _levelId,
        uint256 _requiredMembers,
        uint256 _contributionAmount,
        address _owner
    )
        Ownable(_owner)
    {
        require(_cundinaToken != address(0), "token=0");
        require(_owner != address(0), "owner=0");
        require(_requiredMembers > 0, "requiredMembers=0");
        require(_contributionAmount > 0, "contributionAmount=0");

        cundinaToken = IERC20(_cundinaToken);
        levelId = _levelId;
        requiredMembers = _requiredMembers;
        contributionAmount = _contributionAmount;

        totalCundina = _requiredMembers * _contributionAmount;

        status = BlockStatus.Active;
        createdAt = block.timestamp;
    }

    function joinBlock() external nonReentrant {
        require(status == BlockStatus.Active, "Block is not active");
        require(!isMember[msg.sender], "Already a member");
        require(members.length < requiredMembers, "Block is full");

        // Optional: disallow fee-on-transfer tokens (recommended for predictability)
        uint256 beforeBal = cundinaToken.balanceOf(address(this));
        cundinaToken.safeTransferFrom(msg.sender, address(this), contributionAmount);
        uint256 afterBal = cundinaToken.balanceOf(address(this));
        require(afterBal - beforeBal == contributionAmount, "Fee-on-transfer not supported");

        members.push(msg.sender);
        isMember[msg.sender] = true;
        contributions[msg.sender] = contributionAmount;

        emit MemberJoined(msg.sender, members.length, contributionAmount);

        if (members.length == requiredMembers) {
            status = BlockStatus.Completed;
            completedAt = block.timestamp;
            emit BlockCompleted(completedAt);
        }
    }

    function withdrawToCreator() external onlyOwner nonReentrant {
        require(status == BlockStatus.Completed, "Block not completed");

        uint256 contractBalance = cundinaToken.balanceOf(address(this));
        require(contractBalance > 0, "No funds to withdraw");

        status = BlockStatus.Distributed;

        address creator = owner();
        cundinaToken.safeTransfer(creator, contractBalance);

        emit FundsTransferredToCreator(creator, contractBalance);
    }

    function getContractBalance() external view returns (uint256) {
        return cundinaToken.balanceOf(address(this));
    }

    function getMembers() external view returns (address[] memory) {
        return members;
    }

    function getBlockInfo()
        external
        view
        returns (
            uint256 _levelId,
            uint256 _requiredMembers,
            uint256 _currentMembers,
            uint256 _contributionAmount,
            uint256 _totalCundina,
            BlockStatus _status,
            uint256 _createdAt,
            uint256 _completedAt
        )
    {
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
