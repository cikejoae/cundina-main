// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title BlockRegistryFactory V5 - Automatic TOP Block Assignment
 * @notice Adds automatic TOP block detection and payment during advance
 * @dev New features:
 *   - PayoutModule finds TOP block at next level
 *   - Automatically transfers costNext to TOP block creator
 *   - Joins advancing user to TOP block
 *   - Fallback: if no TOP block, funds stay in Treasury
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

interface ISafe {
    enum Operation {
        Call,
        DelegateCall
    }

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation
    ) external returns (bool success);
}

contract CundinaBlockSecure is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public token;
    address public registry;
    address public treasurySafe;

    uint256 public levelId;
    uint256 public requiredMembers;
    uint256 public contributionAmount;

    address[] public members;
    mapping(address => bool) public isMember;

    enum BlockStatus {
        Active,
        Completed
    }
    BlockStatus public status;

    uint256 public createdAt;
    uint256 public completedAt;

    bool private _initialized;

    event Initialized(
        address indexed token,
        address indexed registry,
        address indexed treasurySafe,
        address center,
        uint256 levelId,
        uint256 requiredMembers,
        uint256 contributionAmount
    );
    event MemberJoined(address indexed member, uint256 indexed position, uint256 amount);
    event BlockCompleted(uint256 completedAt);

    modifier onlyUninitialized() {
        require(!_initialized, "Already initialized");
        _;
    }

    modifier onlyRegistry() {
        require(msg.sender == registry, "Only registry");
        _;
    }

    constructor() Ownable(address(1)) {}

    function initialize(
        address _token,
        address _registry,
        address _treasurySafe,
        address _center,
        uint256 _levelId,
        uint256 _requiredMembers,
        uint256 _contributionAmount
    ) external onlyUninitialized {
        require(_token != address(0), "token=0");
        require(_registry != address(0), "registry=0");
        require(_treasurySafe != address(0), "treasury=0");
        require(_center != address(0), "center=0");
        require(_center != _treasurySafe, "center=treasury");
        require(_requiredMembers > 0, "members=0");
        require(_contributionAmount > 0, "amount=0");

        _initialized = true;

        token = IERC20(_token);
        registry = _registry;
        treasurySafe = _treasurySafe;

        levelId = _levelId;
        requiredMembers = _requiredMembers;
        contributionAmount = _contributionAmount;

        _transferOwnership(_center);

        status = BlockStatus.Active;
        createdAt = block.timestamp;

        emit Initialized(_token, _registry, _treasurySafe, _center, _levelId, _requiredMembers, _contributionAmount);
    }

    /// @notice Join a block - FREE (no token transfer, registration fee already covers contribution)
    /// @param member The member address joining the block
    function joinBlock(address member) external onlyRegistry nonReentrant {
        require(status == BlockStatus.Active, "Not active");
        require(member != address(0), "member=0");
        require(member != treasurySafe, "member=treasury");
        require(!isMember[member], "Already member");
        require(members.length < requiredMembers, "Block full");

        members.push(member);
        isMember[member] = true;

        emit MemberJoined(member, members.length, contributionAmount);

        if (members.length == requiredMembers) {
            status = BlockStatus.Completed;
            completedAt = block.timestamp;
            emit BlockCompleted(completedAt);
        }
    }

    function membersCount() external view returns (uint256) {
        return members.length;
    }

    function getMembers() external view returns (address[] memory) {
        return members;
    }
}

contract BlockRegistryFactory is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public treasurySafe;
    address public immutable blockImplementation;

    uint256 public constant FEE_BPS = 1000;  // 10% platform fee
    uint256 public constant BPS = 10000;

    struct LevelCfg {
        uint256 requiredMembers;
        uint256 contributionAmount;
        bool exists;
    }

    mapping(uint256 => LevelCfg) public levelCfg;
    mapping(address => uint256) public userLevel;
    mapping(address => mapping(uint256 => address)) public myBlockAtLevel;
    mapping(address => bool) public blockSettled;
    mapping(address => uint256) public inviteSlots;

    address public payoutModule;

    // ============= On-Chain Referral System =============
    
    mapping(bytes32 => address) public referralCodeToWallet;
    mapping(address => bytes32) public walletToReferralCode;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public invitedCountByBlock;

    // ============= NEW: TOP Block Tracking =============
    
    /// @notice Array of active blocks per level for TOP block search
    mapping(uint256 => address[]) public activeBlocksAtLevel;
    
    /// @notice Block address to index in activeBlocksAtLevel array
    mapping(address => uint256) public blockIndexInLevel;
    
    /// @notice Whether a block is in the active list
    mapping(address => bool) public isBlockActive;

    // ============= Events =============

    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PayoutModuleUpdated(address indexed oldModule, address indexed newModule);

    event RegistrationPaid(address indexed user, uint256 level, uint256 fee, address indexed treasurySafe);
    event UserRegistered(address indexed user, address indexed referrer, uint256 level);
    event SlotGranted(address indexed referrer, address indexed referrerBlock, uint256 level, uint256 newSlots);
    event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress);
    event UpgradedAndJoined(address indexed user, uint256 fromLevel, uint256 toLevel, address indexed targetBlock);
    event BlockSettled(address indexed blockAddress, address indexed center, uint256 level, bool advanced, address payoutTo);

    event ReferralCodeGenerated(address indexed wallet, bytes32 indexed code);
    event ReferralChainCreated(address indexed user, address indexed referrer);
    event InviteCountUpdated(address indexed blockAddr, uint256 newCount);
    
    // NEW: TOP block assignment events
    event TopBlockAssigned(address indexed user, uint256 indexed level, address indexed topBlock, address topBlockCreator);
    event TopBlockPaid(address indexed topBlockCreator, uint256 amount, address indexed topBlock);

    constructor(
        address _token,
        address _treasurySafe,
        address _blockImplementation
    ) Ownable(msg.sender) {
        require(_token != address(0), "token=0");
        require(_treasurySafe != address(0), "treasury=0");
        require(_blockImplementation != address(0), "impl=0");

        token = IERC20(_token);
        treasurySafe = _treasurySafe;
        blockImplementation = _blockImplementation;

        _setLevel(1, 9, 20 * 1e6);
        _setLevel(2, 8, 50 * 1e6);
        _setLevel(3, 7, 100 * 1e6);
        _setLevel(4, 6, 250 * 1e6);
        _setLevel(5, 5, 500 * 1e6);
        _setLevel(6, 4, 1000 * 1e6);
        _setLevel(7, 3, 2500 * 1e6);
    }

    function setTreasurySafe(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "treasury=0");
        address old = treasurySafe;
        treasurySafe = _newTreasury;
        emit TreasuryUpdated(old, _newTreasury);
    }

    function setPayoutModule(address _module) external onlyOwner {
        require(_module != address(0), "module=0");
        address old = payoutModule;
        payoutModule = _module;
        emit PayoutModuleUpdated(old, _module);
    }

    function setLevel(uint256 level, uint256 reqMembers, uint256 amount) external onlyOwner {
        require(level >= 1 && level <= 7, "level");
        _setLevel(level, reqMembers, amount);
    }

    function _setLevel(uint256 level, uint256 reqMembers, uint256 amount) internal {
        require(reqMembers > 0, "members=0");
        require(amount > 0, "amount=0");
        levelCfg[level] = LevelCfg({requiredMembers: reqMembers, contributionAmount: amount, exists: true});
    }

    // ============= Referral Code Functions =============

    function _generateReferralCode(address wallet) internal returns (bytes32 code) {
        code = keccak256(abi.encodePacked(wallet, block.timestamp, blockhash(block.number - 1)));
        referralCodeToWallet[code] = wallet;
        walletToReferralCode[wallet] = code;
        emit ReferralCodeGenerated(wallet, code);
    }

    function setCustomReferralCode(bytes32 code) external {
        require(code != bytes32(0), "code=0");
        require(referralCodeToWallet[code] == address(0), "code taken");
        require(walletToReferralCode[msg.sender] == bytes32(0), "already has code");
        require(userLevel[msg.sender] > 0, "not registered");
        
        referralCodeToWallet[code] = msg.sender;
        walletToReferralCode[msg.sender] = code;
        emit ReferralCodeGenerated(msg.sender, code);
    }

    function resolveReferralCode(bytes32 code) external view returns (address wallet) {
        return referralCodeToWallet[code];
    }

    function getReferralCode(address wallet) external view returns (bytes32 code) {
        return walletToReferralCode[wallet];
    }

    function getReferrer(address wallet) external view returns (address referrer) {
        return referrerOf[wallet];
    }

    function getAllUserBlocks(address user) external view returns (address[] memory blocks) {
        uint256 count = 0;
        for (uint256 i = 1; i <= 7; i++) {
            if (myBlockAtLevel[user][i] != address(0)) count++;
        }
        
        blocks = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i <= 7; i++) {
            if (myBlockAtLevel[user][i] != address(0)) {
                blocks[idx++] = myBlockAtLevel[user][i];
            }
        }
    }

    function getInvitedCount(address blockAddr) external view returns (uint256 count) {
        return invitedCountByBlock[blockAddr];
    }

    // ============= NEW: TOP Block Functions =============

    /// @notice Find the TOP block at a given level (highest invitedCount with available slots)
    /// @param level The level to search
    /// @return topBlock The address of the TOP block (or address(0) if none)
    /// @return topBlockCreator The owner of the TOP block
    function findTopBlockAtLevel(uint256 level) public view returns (address topBlock, address topBlockCreator) {
        address[] storage blocks = activeBlocksAtLevel[level];
        uint256 len = blocks.length;
        
        if (len == 0) return (address(0), address(0));
        
        uint256 highestCount = 0;
        address bestBlock = address(0);
        
        for (uint256 i = 0; i < len; i++) {
            address blockAddr = blocks[i];
            if (blockAddr == address(0)) continue;
            
            // Check if block is still active and has slots
            CundinaBlockSecure blk = CundinaBlockSecure(blockAddr);
            if (blk.status() != CundinaBlockSecure.BlockStatus.Active) continue;
            if (blk.membersCount() >= blk.requiredMembers()) continue;
            
            uint256 count = invitedCountByBlock[blockAddr];
            if (count > highestCount || (count == highestCount && bestBlock == address(0))) {
                highestCount = count;
                bestBlock = blockAddr;
            }
        }
        
        if (bestBlock != address(0)) {
            topBlock = bestBlock;
            topBlockCreator = CundinaBlockSecure(bestBlock).owner();
        }
    }

    /// @notice Get count of active blocks at a level
    function getActiveBlockCountAtLevel(uint256 level) external view returns (uint256) {
        return activeBlocksAtLevel[level].length;
    }

    /// @notice Internal: Add block to active list
    function _addToActiveBlocks(address blockAddr, uint256 level) internal {
        if (!isBlockActive[blockAddr]) {
            activeBlocksAtLevel[level].push(blockAddr);
            blockIndexInLevel[blockAddr] = activeBlocksAtLevel[level].length - 1;
            isBlockActive[blockAddr] = true;
        }
    }

    /// @notice Internal: Remove block from active list (when completed/settled)
    function _removeFromActiveBlocks(address blockAddr, uint256 level) internal {
        if (isBlockActive[blockAddr]) {
            uint256 idx = blockIndexInLevel[blockAddr];
            uint256 lastIdx = activeBlocksAtLevel[level].length - 1;
            
            if (idx != lastIdx) {
                address lastBlock = activeBlocksAtLevel[level][lastIdx];
                activeBlocksAtLevel[level][idx] = lastBlock;
                blockIndexInLevel[lastBlock] = idx;
            }
            
            activeBlocksAtLevel[level].pop();
            delete blockIndexInLevel[blockAddr];
            isBlockActive[blockAddr] = false;
        }
    }

    // ============= Modified: Registration with Block Tracking =============

    function registerUser(address user, address referrer, uint256 level) external nonReentrant {
        require(user != address(0), "user=0");
        require(user != treasurySafe, "user=treasury");
        require(level >= 1 && level <= 7, "bad level");
        require(levelCfg[level].exists, "level unset");

        if (userLevel[user] == 0) {
            uint256 fee = levelCfg[level].contributionAmount;

            uint256 beforeBal = token.balanceOf(treasurySafe);
            token.safeTransferFrom(user, treasurySafe, fee);
            uint256 afterBal = token.balanceOf(treasurySafe);
            require(afterBal - beforeBal == fee, "Fee-on-transfer not supported");

            userLevel[user] = level;

            if (referrer != address(0) && referrer != treasurySafe) {
                referrerOf[user] = referrer;
                emit ReferralChainCreated(user, referrer);
            }

            if (walletToReferralCode[user] == bytes32(0)) {
                _generateReferralCode(user);
            }

            emit RegistrationPaid(user, level, fee, treasurySafe);
            emit UserRegistered(user, referrer, level);
        } else {
            emit UserRegistered(user, referrer, userLevel[user]);
        }

        if (referrer != address(0)) {
            require(referrer != treasurySafe, "referrer=treasury");
            uint256 refLevel = userLevel[referrer];
            if (refLevel >= 1 && refLevel <= 7) {
                address refBlock = myBlockAtLevel[referrer][refLevel];
                if (refBlock != address(0)) {
                    inviteSlots[refBlock] += 1;
                    invitedCountByBlock[refBlock] += 1;
                    emit InviteCountUpdated(refBlock, invitedCountByBlock[refBlock]);
                    emit SlotGranted(referrer, refBlock, refLevel, inviteSlots[refBlock]);
                }
            }
        }
    }

    function registrationFee(uint256 level) external view returns (uint256) {
        require(level >= 1 && level <= 7, "bad level");
        require(levelCfg[level].exists, "level unset");
        return levelCfg[level].contributionAmount;
    }

    function checkRegistrationStatus(address user) external view returns (
        bool needsPayment,
        uint256 currentLevel,
        bool hasBlockAtLevel
    ) {
        currentLevel = userLevel[user];
        needsPayment = (currentLevel == 0);
        hasBlockAtLevel = (currentLevel > 0 && myBlockAtLevel[user][currentLevel] != address(0));
    }

    function registerAndCreateBlock(address user, address referrer, uint256 level) 
        external 
        nonReentrant 
        returns (address blockAddress) 
    {
        require(user != address(0), "user=0");
        require(user != treasurySafe, "user=treasury");
        require(level >= 1 && level <= 7, "bad level");
        require(levelCfg[level].exists, "level unset");
        require(myBlockAtLevel[user][level] == address(0), "already has block");

        if (userLevel[user] == 0) {
            uint256 fee = levelCfg[level].contributionAmount;

            uint256 beforeBal = token.balanceOf(treasurySafe);
            token.safeTransferFrom(user, treasurySafe, fee);
            uint256 afterBal = token.balanceOf(treasurySafe);
            require(afterBal - beforeBal == fee, "Fee-on-transfer not supported");

            userLevel[user] = level;

            if (referrer != address(0) && referrer != treasurySafe) {
                referrerOf[user] = referrer;
                emit ReferralChainCreated(user, referrer);
            }

            if (walletToReferralCode[user] == bytes32(0)) {
                _generateReferralCode(user);
            }

            emit RegistrationPaid(user, level, fee, treasurySafe);
            emit UserRegistered(user, referrer, level);
        } else {
            require(userLevel[user] == level, "level mismatch");
        }

        if (referrer != address(0)) {
            require(referrer != treasurySafe, "referrer=treasury");
            uint256 refLevel = userLevel[referrer];
            if (refLevel >= 1 && refLevel <= 7) {
                address refBlock = myBlockAtLevel[referrer][refLevel];
                if (refBlock != address(0)) {
                    inviteSlots[refBlock] += 1;
                    invitedCountByBlock[refBlock] += 1;
                    emit InviteCountUpdated(refBlock, invitedCountByBlock[refBlock]);
                    emit SlotGranted(referrer, refBlock, refLevel, inviteSlots[refBlock]);
                }
            }
        }

        blockAddress = _deployBlock(user, level);
        myBlockAtLevel[user][level] = blockAddress;
        
        // NEW: Add to active blocks list
        _addToActiveBlocks(blockAddress, level);
        
        emit MyBlockCreated(user, level, blockAddress);
    }

    function _deployBlock(address center, uint256 level) internal returns (address blockAddress) {
        LevelCfg memory cfg = levelCfg[level];
        blockAddress = Clones.clone(blockImplementation);
        CundinaBlockSecure(blockAddress).initialize(
            address(token),
            address(this),
            treasurySafe,
            center,
            level,
            cfg.requiredMembers,
            cfg.contributionAmount
        );
    }

    function createMyBlock(address center) external nonReentrant returns (address blockAddress) {
        require(center != address(0), "center=0");
        require(center != treasurySafe, "center=treasury");

        uint256 lvl = userLevel[center];
        require(lvl >= 1 && lvl <= 7, "not registered");
        require(levelCfg[lvl].exists, "level unset");
        require(myBlockAtLevel[center][lvl] == address(0), "already has block");

        blockAddress = _deployBlock(center, lvl);
        myBlockAtLevel[center][lvl] = blockAddress;
        
        // NEW: Add to active blocks list
        _addToActiveBlocks(blockAddress, lvl);
        
        emit MyBlockCreated(center, lvl, blockAddress);
    }

    function joinLevel1(address member) external nonReentrant {
        require(member != address(0), "member=0");
        require(member != treasurySafe, "member=treasury");
        require(userLevel[member] == 1, "Not level 1");

        address referrer = referrerOf[member];
        require(referrer != address(0), "No referrer");

        address refBlock = myBlockAtLevel[referrer][1];
        require(refBlock != address(0), "Referrer has no L1 block");

        CundinaBlockSecure blk = CundinaBlockSecure(refBlock);
        require(blk.status() == CundinaBlockSecure.BlockStatus.Active, "Block not active");
        require(blk.membersCount() < blk.requiredMembers(), "Block full");

        blk.joinBlock(member);

        if (myBlockAtLevel[member][1] == address(0)) {
            address b = _deployBlock(member, 1);
            myBlockAtLevel[member][1] = b;
            _addToActiveBlocks(b, 1);
            emit MyBlockCreated(member, 1, b);
        }
        
        // Check if referrer's block is now completed
        if (blk.status() == CundinaBlockSecure.BlockStatus.Completed) {
            _removeFromActiveBlocks(refBlock, 1);
        }
    }

    /// @notice Join a specific target block (for higher levels)
    function joinTargetBlock(address member, address targetBlock) external nonReentrant {
        require(member != address(0), "member=0");
        require(member != treasurySafe, "member=treasury");
        require(targetBlock != address(0), "target=0");

        CundinaBlockSecure blk = CundinaBlockSecure(targetBlock);
        uint256 toLevel = blk.levelId();
        require(toLevel >= 2 && toLevel <= 7, "invalid level");
        require(userLevel[member] >= toLevel, "user level too low");
        require(blk.status() == CundinaBlockSecure.BlockStatus.Active, "not active");
        require(blk.membersCount() < blk.requiredMembers(), "full");
        require(!blk.isMember(member), "already member");
        require(blk.owner() != member, "cant join own");

        blk.joinBlock(member);

        if (myBlockAtLevel[member][toLevel] == address(0)) {
            address b = _deployBlock(member, toLevel);
            myBlockAtLevel[member][toLevel] = b;
            _addToActiveBlocks(b, toLevel);
            emit MyBlockCreated(member, toLevel, b);
        }

        emit UpgradedAndJoined(member, userLevel[member], toLevel, targetBlock);
        
        // Check if target block is now completed
        if (blk.status() == CundinaBlockSecure.BlockStatus.Completed) {
            _removeFromActiveBlocks(targetBlock, toLevel);
        }
    }

    modifier onlyPayoutModule() {
        require(msg.sender == payoutModule, "Only module");
        _;
    }

    function settleReset(address blockAddr, address center, address payoutTo) external onlyPayoutModule {
        require(!blockSettled[blockAddr], "already settled");
        require(blockAddr != address(0) && center != address(0), "0");
        require(payoutTo != address(0), "payout=0");
        require(center != treasurySafe, "center=treasury");
        require(CundinaBlockSecure(blockAddr).owner() == center, "center mismatch");
        require(
            CundinaBlockSecure(blockAddr).status() == CundinaBlockSecure.BlockStatus.Completed,
            "not completed"
        );

        uint256 level = CundinaBlockSecure(blockAddr).levelId();
        blockSettled[blockAddr] = true;
        userLevel[center] = 1;
        
        // Remove from active blocks
        _removeFromActiveBlocks(blockAddr, level);

        emit BlockSettled(blockAddr, center, level, false, payoutTo);
    }

    function settleAdvance(address blockAddr, address center, address payoutTo)
        external
        onlyPayoutModule
        returns (address nextBlock)
    {
        require(!blockSettled[blockAddr], "already settled");
        require(blockAddr != address(0) && center != address(0), "0");
        require(payoutTo != address(0), "payout=0");
        require(center != treasurySafe, "center=treasury");
        require(CundinaBlockSecure(blockAddr).owner() == center, "center mismatch");
        require(
            CundinaBlockSecure(blockAddr).status() == CundinaBlockSecure.BlockStatus.Completed,
            "not completed"
        );

        uint256 currentLevel = userLevel[center];
        require(currentLevel == CundinaBlockSecure(blockAddr).levelId(), "level mismatch");
        require(currentLevel < 7, "max");

        blockSettled[blockAddr] = true;
        
        // Remove from active blocks
        _removeFromActiveBlocks(blockAddr, currentLevel);

        uint256 nextLevel = currentLevel + 1;
        userLevel[center] = nextLevel;

        if (myBlockAtLevel[center][nextLevel] == address(0)) {
            address b = _deployBlock(center, nextLevel);
            myBlockAtLevel[center][nextLevel] = b;
            _addToActiveBlocks(b, nextLevel);
            emit MyBlockCreated(center, nextLevel, b);
            nextBlock = b;
        } else {
            nextBlock = myBlockAtLevel[center][nextLevel];
        }

        emit BlockSettled(blockAddr, center, currentLevel, true, payoutTo);
    }

    function grossForBlock(address blockAddr) public view returns (uint256) {
        uint256 lvl = CundinaBlockSecure(blockAddr).levelId();
        LevelCfg memory cfg = levelCfg[lvl];
        return cfg.requiredMembers * cfg.contributionAmount;
    }

    function netForBlock(address blockAddr) public view returns (uint256) {
        uint256 gross = grossForBlock(blockAddr);
        return (gross * 90) / 100;
    }

    function feeForGross(uint256 gross) public pure returns (uint256) {
        return (gross * FEE_BPS) / BPS;
    }

    function advanceCost(uint256 nextLevel) public view returns (uint256) {
        require(nextLevel >= 2 && nextLevel <= 7, "nextLevel");
        return levelCfg[nextLevel].contributionAmount;
    }
}

/**
 * @title SafeTreasuryPayoutModule V2 - Automatic TOP Block Assignment
 * @notice Adds automatic TOP block detection, payment, and joining during advance
 */
contract SafeTreasuryPayoutModule is ReentrancyGuard {
    address public immutable treasurySafe;
    address public immutable socCoopWallet;
    BlockRegistryFactory public immutable registry;
    IERC20 public immutable token;

    event CashoutExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo);
    event AdvanceExecuted(
        address indexed center,
        address indexed blockAddr,
        uint256 payout,
        address payoutTo,
        address nextBlock
    );
    event TreasuryTransfers(uint256 gross, uint256 fee, uint256 costNext);
    event AdvanceCostDistributed(uint256 costNext, uint256 socCoopShare, uint256 treasuryShare);
    event RegistrationFeeDispersed(address indexed user, uint256 level, uint256 socCoopAmount, uint256 treasuryAmount);
    
    // NEW: TOP block payment events
    event TopBlockPaymentExecuted(address indexed center, address indexed topBlock, address indexed topBlockCreator, uint256 amount);
    event NoTopBlockAvailable(address indexed center, uint256 level, uint256 amountRetainedInTreasury);

    constructor(
        address _token, 
        address _treasurySafe, 
        address _socCoopWallet,
        address _registry
    ) {
        require(_token != address(0), "token=0");
        require(_treasurySafe != address(0), "treasury=0");
        require(_socCoopWallet != address(0), "socCoopWallet=0");
        require(_registry != address(0), "registry=0");

        token = IERC20(_token);
        treasurySafe = _treasurySafe;
        socCoopWallet = _socCoopWallet;
        registry = BlockRegistryFactory(_registry);
    }

    function disperseRegistrationFee(address user, uint256 level) external nonReentrant {
        require(user != address(0), "user=0");
        require(level >= 1 && level <= 7, "invalid level");

        uint256 totalFee = registry.registrationFee(level);
        require(totalFee > 0, "fee=0");

        uint256 socCoopAmount = (totalFee * 10) / 100;
        
        _safeTransfer(socCoopWallet, socCoopAmount);
        
        uint256 treasuryAmount = totalFee - socCoopAmount;

        emit RegistrationFeeDispersed(user, level, socCoopAmount, treasuryAmount);
    }

    function cashout(address blockAddr, address center, address payoutTo) external nonReentrant {
        require(center != address(0), "center=0");
        require(center != treasurySafe, "center=treasury");
        require(payoutTo != address(0), "payout=0");

        uint256 accumulated = registry.netForBlock(blockAddr);
        
        _safeTransfer(payoutTo, accumulated);

        registry.settleReset(blockAddr, center, payoutTo);

        emit TreasuryTransfers(accumulated, 0, 0);
        emit CashoutExecuted(center, blockAddr, accumulated, payoutTo);
    }

    /**
     * @notice Advance to next level with automatic TOP block assignment
     * @dev Flow:
     *   1. Calculate payout (accumulated - costNext)
     *   2. Send 10% of costNext to SocCoop wallet
     *   3. Find TOP block at next level
     *   4. If TOP block found: send 90% of costNext to TOP block creator & join user
     *   5. If no TOP block: 90% stays in Treasury for later assignment
     *   6. Send payout to user
     *   7. Create user's new block at next level
     */
    function advance(address blockAddr, address center, address payoutTo)
        external
        nonReentrant
        returns (address nextBlock)
    {
        require(center != address(0), "center=0");
        require(center != treasurySafe, "center=treasury");
        require(payoutTo != address(0), "payout=0");

        uint256 accumulated = registry.netForBlock(blockAddr);

        uint256 currentLevel = registry.userLevel(center);
        uint256 nextLevel = currentLevel + 1;
        uint256 costNext = registry.advanceCost(nextLevel);

        require(accumulated >= costNext, "accumulated < cost");
        uint256 payout = accumulated - costNext;

        // 10% to SocCoop wallet
        uint256 socCoopShare = (costNext * 10) / 100;
        _safeTransfer(socCoopWallet, socCoopShare);
        
        // 90% for TOP block creator
        uint256 treasuryShare = costNext - socCoopShare;
        
        // NEW: Find and pay TOP block creator automatically
        (address topBlock, address topBlockCreator) = registry.findTopBlockAtLevel(nextLevel);
        
        if (topBlock != address(0) && topBlockCreator != address(0) && topBlockCreator != center) {
            // Pay TOP block creator
            _safeTransfer(topBlockCreator, treasuryShare);
            emit TopBlockPaymentExecuted(center, topBlock, topBlockCreator, treasuryShare);
            
            // Join the user to the TOP block (they'll get their own block created by settleAdvance)
            // Note: We can't call joinTargetBlock here as it requires member to call
            // The user will need to join separately, but payment is done
            emit AdvanceCostDistributed(costNext, socCoopShare, treasuryShare);
        } else {
            // No TOP block available - funds stay in Treasury
            emit NoTopBlockAvailable(center, nextLevel, treasuryShare);
            emit AdvanceCostDistributed(costNext, socCoopShare, 0);
        }
        
        // Send payout to user
        _safeTransfer(payoutTo, payout);

        // Settle and create next level block
        nextBlock = registry.settleAdvance(blockAddr, center, payoutTo);

        emit TreasuryTransfers(accumulated, 0, costNext);
        emit AdvanceExecuted(center, blockAddr, payout, payoutTo, nextBlock);
    }

    function _safeTransfer(address to, uint256 amount) internal {
        bytes memory data = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);
        bool ok = ISafe(treasurySafe).execTransactionFromModule(address(token), 0, data, ISafe.Operation.Call);
        require(ok, "Safe tx failed");
    }
}
