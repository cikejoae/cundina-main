 // SPDX-License-Identifier: MIT
 pragma solidity ^0.8.28;
 
 /**
  * @title BlockRegistryFactory V4 - On-Chain Migration
  * @notice Adds referral system mappings for 100% on-chain architecture
  * @dev New features:
  *   - referralCodeToWallet: bytes32 → address mapping
  *   - walletToReferralCode: address → bytes32 mapping  
  *   - referrerOf: address → address mapping
  *   - invitedCountByBlock: address → uint256 mapping
  *   - New events: ReferralCodeGenerated, ReferralChainCreated, InviteCountUpdated
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
     address public platformWallet;
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
 
     // ============= NEW: On-Chain Referral System =============
     
     /// @notice Maps referral code (bytes32) to wallet address
     mapping(bytes32 => address) public referralCodeToWallet;
     
     /// @notice Maps wallet address to its referral code
     mapping(address => bytes32) public walletToReferralCode;
     
     /// @notice Maps user wallet to their referrer wallet
     mapping(address => address) public referrerOf;
     
     /// @notice Tracks invited count per block address (for ranking)
     mapping(address => uint256) public invitedCountByBlock;
 
     // ============= Events =============
 
     event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
     event PlatformWalletUpdated(address indexed oldWallet, address indexed newWallet);
     event PayoutModuleUpdated(address indexed oldModule, address indexed newModule);
 
     event RegistrationPaid(address indexed user, uint256 level, uint256 fee, address indexed treasurySafe);
     event UserRegistered(address indexed user, address indexed referrer, uint256 level);
     event SlotGranted(address indexed referrer, address indexed referrerBlock, uint256 level, uint256 newSlots);
     event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress);
     event UpgradedAndJoined(address indexed user, uint256 fromLevel, uint256 toLevel, address indexed targetBlock);
     event BlockSettled(address indexed blockAddress, address indexed center, uint256 level, bool advanced, address payoutTo);
 
     // NEW: Referral system events for indexing
     event ReferralCodeGenerated(address indexed wallet, bytes32 indexed code);
     event ReferralChainCreated(address indexed user, address indexed referrer);
     event InviteCountUpdated(address indexed blockAddr, uint256 newCount);
 
     constructor(
         address _token,
         address _treasurySafe,
         address _platformWallet,
         address _blockImplementation
     ) Ownable(msg.sender) {
         require(_token != address(0), "token=0");
         require(_treasurySafe != address(0), "treasury=0");
         require(_platformWallet != address(0), "platform=0");
         require(_blockImplementation != address(0), "impl=0");
 
         token = IERC20(_token);
         treasurySafe = _treasurySafe;
         platformWallet = _platformWallet;
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
 
     function updatePlatformWallet(address _newWallet) external onlyOwner {
         require(_newWallet != address(0), "platform=0");
         address old = platformWallet;
         platformWallet = _newWallet;
         emit PlatformWalletUpdated(old, _newWallet);
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
 
     // ============= NEW: Referral Code Functions =============
 
     /// @notice Generate a referral code for a wallet (auto-generated on first registration)
     /// @dev Called internally during registration
     function _generateReferralCode(address wallet) internal returns (bytes32 code) {
         // Create deterministic but unique code based on wallet + timestamp + blockhash
         code = keccak256(abi.encodePacked(wallet, block.timestamp, blockhash(block.number - 1)));
         referralCodeToWallet[code] = wallet;
         walletToReferralCode[wallet] = code;
         emit ReferralCodeGenerated(wallet, code);
     }
 
     /// @notice Set a custom referral code (must be unique, only if no code exists)
     /// @param code The custom code to set
     function setCustomReferralCode(bytes32 code) external {
         require(code != bytes32(0), "code=0");
         require(referralCodeToWallet[code] == address(0), "code taken");
         require(walletToReferralCode[msg.sender] == bytes32(0), "already has code");
         require(userLevel[msg.sender] > 0, "not registered");
         
         referralCodeToWallet[code] = msg.sender;
         walletToReferralCode[msg.sender] = code;
         emit ReferralCodeGenerated(msg.sender, code);
     }
 
     /// @notice Resolve a referral code to wallet address (view function for frontend)
     /// @param code The referral code to resolve
     /// @return wallet The wallet address, or address(0) if not found
     function resolveReferralCode(bytes32 code) external view returns (address wallet) {
         return referralCodeToWallet[code];
     }
 
     /// @notice Get the referral code for a wallet
     /// @param wallet The wallet address
     /// @return code The referral code, or bytes32(0) if none
     function getReferralCode(address wallet) external view returns (bytes32 code) {
         return walletToReferralCode[wallet];
     }
 
     /// @notice Get the referrer of a wallet
     /// @param wallet The wallet address
     /// @return referrer The referrer address, or address(0) if none
     function getReferrer(address wallet) external view returns (address referrer) {
         return referrerOf[wallet];
     }
 
     /// @notice Get all blocks for a user (view function for Dashboard)
     /// @param user The user address
     /// @return blocks Array of block addresses
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
 
     /// @notice Get invited count for a specific block (for ranking)
     /// @param blockAddr The block address
     /// @return count The number of invited users
     function getInvitedCount(address blockAddr) external view returns (uint256 count) {
         return invitedCountByBlock[blockAddr];
     }
 
     // ============= Modified: Registration with Referral Storage =============
 
     /// @notice Register a user for a specific level. Fee = levelCfg[level].contributionAmount
     /// @param user The address to register
     /// @param referrer The referrer address (can be address(0))
     /// @param level The level to register for (1-7)
     function registerUser(address user, address referrer, uint256 level) external nonReentrant {
         require(user != address(0), "user=0");
         require(user != treasurySafe, "user=treasury");
         require(level >= 1 && level <= 7, "bad level");
         require(levelCfg[level].exists, "level unset");
 
         if (userLevel[user] == 0) {
             // Registration fee = contribution amount for the target level
             uint256 fee = levelCfg[level].contributionAmount;
 
             uint256 beforeBal = token.balanceOf(treasurySafe);
             token.safeTransferFrom(user, treasurySafe, fee);
             uint256 afterBal = token.balanceOf(treasurySafe);
             require(afterBal - beforeBal == fee, "Fee-on-transfer not supported");
 
             userLevel[user] = level;
 
             // NEW: Store referral chain
             if (referrer != address(0) && referrer != treasurySafe) {
                 referrerOf[user] = referrer;
                 emit ReferralChainCreated(user, referrer);
             }
 
             // NEW: Generate referral code for new user
             if (walletToReferralCode[user] == bytes32(0)) {
                 _generateReferralCode(user);
             }
 
             emit RegistrationPaid(user, level, fee, treasurySafe);
             emit UserRegistered(user, referrer, level);
         } else {
             emit UserRegistered(user, referrer, userLevel[user]);
         }
 
         // Handle referrer invite count
         if (referrer != address(0)) {
             require(referrer != treasurySafe, "referrer=treasury");
             uint256 refLevel = userLevel[referrer];
             if (refLevel >= 1 && refLevel <= 7) {
                 address refBlock = myBlockAtLevel[referrer][refLevel];
                 if (refBlock != address(0)) {
                     inviteSlots[refBlock] += 1;
                     
                     // NEW: Update block-specific invite count
                     invitedCountByBlock[refBlock] += 1;
                     emit InviteCountUpdated(refBlock, invitedCountByBlock[refBlock]);
                     
                     emit SlotGranted(referrer, refBlock, refLevel, inviteSlots[refBlock]);
                 }
             }
         }
     }
 
     /// @notice Get registration fee for a specific level
     function registrationFee(uint256 level) external view returns (uint256) {
         require(level >= 1 && level <= 7, "bad level");
         require(levelCfg[level].exists, "level unset");
         return levelCfg[level].contributionAmount;
     }
 
     /// @notice Check if a user needs to pay registration fee
     function checkRegistrationStatus(address user) external view returns (
         bool needsPayment,
         uint256 currentLevel,
         bool hasBlockAtLevel
     ) {
         currentLevel = userLevel[user];
         needsPayment = (currentLevel == 0);
         hasBlockAtLevel = (currentLevel > 0 && myBlockAtLevel[user][currentLevel] != address(0));
     }
 
     /// @notice Register and create block in one transaction
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
 
             // NEW: Store referral chain
             if (referrer != address(0) && referrer != treasurySafe) {
                 referrerOf[user] = referrer;
                 emit ReferralChainCreated(user, referrer);
             }
 
             // NEW: Generate referral code
             if (walletToReferralCode[user] == bytes32(0)) {
                 _generateReferralCode(user);
             }
 
             emit RegistrationPaid(user, level, fee, treasurySafe);
             emit UserRegistered(user, referrer, level);
         } else {
             require(userLevel[user] == level, "level mismatch");
             emit UserRegistered(user, referrer, userLevel[user]);
         }
 
         // Handle referrer slots
         if (referrer != address(0)) {
             require(referrer != treasurySafe, "referrer=treasury");
             uint256 refLevel = userLevel[referrer];
             if (refLevel >= 1 && refLevel <= 7) {
                 address refBlock = myBlockAtLevel[referrer][refLevel];
                 if (refBlock != address(0)) {
                     inviteSlots[refBlock] += 1;
                     
                     // NEW: Update block-specific invite count
                     invitedCountByBlock[refBlock] += 1;
                     emit InviteCountUpdated(refBlock, invitedCountByBlock[refBlock]);
                     
                     emit SlotGranted(referrer, refBlock, refLevel, inviteSlots[refBlock]);
                 }
             }
         }
 
         blockAddress = _deployBlock(user, level);
         myBlockAtLevel[user][level] = blockAddress;
 
         emit MyBlockCreated(user, level, blockAddress);
         return blockAddress;
     }
 
     function createMyBlock(address center) external nonReentrant returns (address) {
         require(center != address(0), "center=0");
         require(center != treasurySafe, "center=treasury");
 
         uint256 level = userLevel[center];
         require(level >= 1 && level <= 7, "bad level");
         require(levelCfg[level].exists, "level unset");
         require(myBlockAtLevel[center][level] == address(0), "already has block");
 
         address b = _deployBlock(center, level);
         myBlockAtLevel[center][level] = b;
 
         emit MyBlockCreated(center, level, b);
         return b;
     }
 
     function _deployBlock(address center, uint256 level) internal returns (address) {
         LevelCfg memory cfg = levelCfg[level];
 
         address clone = Clones.clone(blockImplementation);
         CundinaBlockSecure(clone).initialize(
             address(token),
             address(this),
             treasurySafe,
             center,
             level,
             cfg.requiredMembers,
             cfg.contributionAmount
         );
         return clone;
     }
 
     function joinLevel1(address targetBlock, address member) external nonReentrant {
         require(targetBlock != address(0), "block=0");
         require(member != address(0), "member=0");
         require(member != treasurySafe, "member=treasury");
         require(userLevel[member] == 1, "member not L1");
         require(CundinaBlockSecure(targetBlock).levelId() == 1, "target not L1");
 
         CundinaBlockSecure(targetBlock).joinBlock(member);
 
         if (myBlockAtLevel[member][1] == address(0)) {
             address b = _deployBlock(member, 1);
             myBlockAtLevel[member][1] = b;
             emit MyBlockCreated(member, 1, b);
         }
     }
 
     function upgradeAndJoin(address user, address targetBlock) external nonReentrant {
         require(user != address(0), "user=0");
         require(user != treasurySafe, "user=treasury");
         require(targetBlock != address(0), "block=0");
 
         uint256 toLevel = CundinaBlockSecure(targetBlock).levelId();
         require(toLevel >= 2 && toLevel <= 7, "bad toLevel");
 
         uint256 fromLevel = userLevel[user];
         require(fromLevel + 1 == toLevel, "not eligible level");
 
         address prevBlock = myBlockAtLevel[user][fromLevel];
         require(prevBlock != address(0), "no prev block");
         require(
             CundinaBlockSecure(prevBlock).status() == CundinaBlockSecure.BlockStatus.Completed,
             "prev not completed"
         );
 
         uint256 joined = CundinaBlockSecure(targetBlock).membersCount();
         require(inviteSlots[targetBlock] > joined, "no slots");
 
         CundinaBlockSecure(targetBlock).joinBlock(user);
 
         userLevel[user] = toLevel;
         emit UpgradedAndJoined(user, fromLevel, toLevel, targetBlock);
 
         if (myBlockAtLevel[user][toLevel] == address(0)) {
             address b = _deployBlock(user, toLevel);
             myBlockAtLevel[user][toLevel] = b;
             emit MyBlockCreated(user, toLevel, b);
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
 
         blockSettled[blockAddr] = true;
         userLevel[center] = 1;
 
         emit BlockSettled(blockAddr, center, CundinaBlockSecure(blockAddr).levelId(), false, payoutTo);
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
 
         uint256 nextLevel = currentLevel + 1;
         userLevel[center] = nextLevel;
 
         if (myBlockAtLevel[center][nextLevel] == address(0)) {
             address b = _deployBlock(center, nextLevel);
             myBlockAtLevel[center][nextLevel] = b;
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
 
 contract SafeTreasuryPayoutModule is ReentrancyGuard {
     address public immutable treasurySafe;
     address public immutable platformWallet;
     address public immutable piWallet;
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
     event AdvanceCostDistributed(uint256 costNext, uint256 piShare, uint256 treasuryShare);
     event RegistrationFeeDispersed(address indexed user, uint256 level, uint256 piAmount, uint256 treasuryAmount);
 
     constructor(
         address _token, 
         address _treasurySafe, 
         address _platformWallet, 
         address _piWallet,
         address _registry
     ) {
         require(_token != address(0), "token=0");
         require(_treasurySafe != address(0), "treasury=0");
         require(_platformWallet != address(0), "platform=0");
         require(_piWallet != address(0), "piWallet=0");
         require(_registry != address(0), "registry=0");
 
         token = IERC20(_token);
         treasurySafe = _treasurySafe;
         platformWallet = _platformWallet;
         piWallet = _piWallet;
         registry = BlockRegistryFactory(_registry);
     }
 
     function disperseRegistrationFee(address user, uint256 level) external nonReentrant {
         require(user != address(0), "user=0");
         require(level >= 1 && level <= 7, "invalid level");
 
         uint256 totalFee = registry.registrationFee(level);
         require(totalFee > 0, "fee=0");
 
         uint256 piAmount = (totalFee * 10) / 100;
         
         _safeTransfer(piWallet, piAmount);
         
         uint256 treasuryAmount = totalFee - piAmount;
 
         emit RegistrationFeeDispersed(user, level, piAmount, treasuryAmount);
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
 
         uint256 piShare = (costNext * 10) / 100;
         
         _safeTransfer(piWallet, piShare);
         _safeTransfer(payoutTo, payout);
 
         nextBlock = registry.settleAdvance(blockAddr, center, payoutTo);
 
         emit TreasuryTransfers(accumulated, 0, costNext);
         emit AdvanceCostDistributed(costNext, piShare, costNext - piShare);
         emit AdvanceExecuted(center, blockAddr, payout, payoutTo, nextBlock);
     }
 
     function _safeTransfer(address to, uint256 amount) internal {
         bytes memory data = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);
         bool ok = ISafe(treasurySafe).execTransactionFromModule(address(token), 0, data, ISafe.Operation.Call);
         require(ok, "Safe tx failed");
     }
 }