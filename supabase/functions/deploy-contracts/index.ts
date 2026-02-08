import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ethers } from "https://esm.sh/ethers@6.13.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sepolia USDT token address (6 decimals)
const CUNDINA_TOKEN_ADDRESS = "0xca32A14f4841027b2fe07E2d593d514a372Ec504";

// ========== ABIs ==========

const CundinaBlockSecureABI = [
  "constructor()",
  "function initialize(address _token, address _registry, address _treasurySafe, address _center, uint256 _levelId, uint256 _requiredMembers, uint256 _contributionAmount) external",
  "function token() view returns (address)",
  "function registry() view returns (address)",
  "function treasurySafe() view returns (address)",
  "function owner() view returns (address)",
  "function levelId() view returns (uint256)",
  "function requiredMembers() view returns (uint256)",
  "function contributionAmount() view returns (uint256)",
  "function status() view returns (uint8)",
  "function membersCount() view returns (uint256)",
  "function getMembers() view returns (address[])",
  "function joinBlock(address member) external",
  "event Initialized(address indexed token, address indexed registry, address indexed treasurySafe, address center, uint256 levelId, uint256 requiredMembers, uint256 contributionAmount)",
  "event MemberJoined(address indexed member, uint256 indexed position, uint256 amount)",
  "event BlockCompleted(uint256 completedAt)"
];

const BlockRegistryFactoryABI = [
  "constructor(address _token, address _treasurySafe, address _platformWallet, address _blockImplementation)",
  "function token() view returns (address)",
  "function treasurySafe() view returns (address)",
  "function platformWallet() view returns (address)",
  "function blockImplementation() view returns (address)",
  "function registrationFee() view returns (uint256)",
  "function levelCfg(uint256) view returns (uint256 requiredMembers, uint256 contributionAmount, bool exists)",
  "function userLevel(address) view returns (uint256)",
  "function myBlockAtLevel(address, uint256) view returns (address)",
  "function blockSettled(address) view returns (bool)",
  "function inviteSlots(address) view returns (uint256)",
  "function payoutModule() view returns (address)",
  "function setPayoutModule(address _module) external",
  "function setTreasurySafe(address _newTreasury) external",
  "function updatePlatformWallet(address _newWallet) external",
  "function registerUser(address user, address referrer) external",
  "function createMyBlock(address center) external returns (address)",
  "function joinLevel1(address targetBlock, address member) external",
  "function upgradeAndJoin(address user, address targetBlock) external",
  "function grossForBlock(address blockAddr) view returns (uint256)",
  "function feeForGross(uint256 gross) pure returns (uint256)",
  "function advanceCost(uint256 nextLevel) view returns (uint256)",
  "event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury)",
  "event PlatformWalletUpdated(address indexed oldWallet, address indexed newWallet)",
  "event PayoutModuleUpdated(address indexed oldModule, address indexed newModule)",
  "event RegistrationPaid(address indexed user, uint256 fee, address indexed treasurySafe)",
  "event UserRegistered(address indexed user, address indexed referrer, uint256 startLevel)",
  "event SlotGranted(address indexed referrer, address indexed referrerBlock, uint256 level, uint256 newSlots)",
  "event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress)",
  "event UpgradedAndJoined(address indexed user, uint256 fromLevel, uint256 toLevel, address indexed targetBlock)",
  "event BlockSettled(address indexed blockAddress, address indexed center, uint256 level, bool advanced, address payoutTo)"
];

const SafeTreasuryPayoutModuleABI = [
  "constructor(address _token, address _treasurySafe, address _platformWallet, address _registry)",
  "function treasurySafe() view returns (address)",
  "function platformWallet() view returns (address)",
  "function registry() view returns (address)",
  "function token() view returns (address)",
  "function cashout(address blockAddr, address center, address payoutTo) external",
  "function advance(address blockAddr, address center, address payoutTo) external returns (address nextBlock)",
  "event CashoutExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo)",
  "event AdvanceExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo, address nextBlock)",
  "event TreasuryTransfers(uint256 gross, uint256 fee, uint256 costNext)"
];

// ========== BYTECODES (compiled with solc 0.8.28, optimizer 200, viaIR) ==========
// These are placeholders - the actual bytecodes need to be compiled from the Solidity source
// For now, we'll compile on-the-fly using solc

const SOLIDITY_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

library Address {
    function isContract(address account) internal view returns (bool) {
        return account.code.length > 0;
    }
}

library SafeERC20 {
    using Address for address;
    
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeWithSelector(token.transfer.selector, to, value));
    }
    
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeWithSelector(token.transferFrom.selector, from, to, value));
    }
    
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        (bool success, bytes memory returndata) = address(token).call(data);
        require(success, "SafeERC20: low-level call failed");
        if (returndata.length > 0) {
            require(abi.decode(returndata, (bool)), "SafeERC20: ERC20 operation did not succeed");
        }
    }
}

abstract contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _status;
    
    constructor() { _status = NOT_ENTERED; }
    
    modifier nonReentrant() {
        require(_status != ENTERED, "ReentrancyGuard: reentrant call");
        _status = ENTERED;
        _;
        _status = NOT_ENTERED;
    }
}

abstract contract Ownable {
    address private _owner;
    address private _pendingOwner;
    
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    
    constructor(address initialOwner) {
        require(initialOwner != address(0), "Ownable: zero address");
        _owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }
    
    function owner() public view returns (address) { return _owner; }
    function pendingOwner() public view returns (address) { return _pendingOwner; }
    
    modifier onlyOwner() {
        require(msg.sender == _owner, "Ownable: caller is not the owner");
        _;
    }
    
    function transferOwnership(address newOwner) public onlyOwner {
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(_owner, newOwner);
    }
    
    function acceptOwnership() public {
        require(msg.sender == _pendingOwner, "Ownable: caller is not the new owner");
        address oldOwner = _owner;
        _owner = _pendingOwner;
        _pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, _owner);
    }
    
    function _transferOwnership(address newOwner) internal {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

library Clones {
    function clone(address implementation) internal returns (address instance) {
        assembly {
            mstore(0x00, or(shr(0xe8, shl(0x60, implementation)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, implementation), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create(0, 0x09, 0x37)
        }
        require(instance != address(0), "ERC1167: create failed");
    }
}

interface ISafe {
    enum Operation { Call, DelegateCall }
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, Operation operation) external returns (bool success);
}

contract CundinaBlockSecure is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public token;
    address public registry;
    address public treasurySafe;

    uint256 public levelId;
    uint256 public requiredMembers;
    uint256 public contributionAmount;

    address[] public members;
    mapping(address => bool) public isMember;

    enum BlockStatus { Active, Completed }
    BlockStatus public status;

    uint256 public createdAt;
    uint256 public completedAt;

    bool private _initialized;

    event Initialized(address indexed token, address indexed registry, address indexed treasurySafe, address center, uint256 levelId, uint256 requiredMembers, uint256 contributionAmount);
    event MemberJoined(address indexed member, uint256 indexed position, uint256 amount);
    event BlockCompleted(uint256 completedAt);

    modifier onlyUninitialized() { require(!_initialized, "Already initialized"); _; }
    modifier onlyRegistry() { require(msg.sender == registry, "Only registry"); _; }

    constructor() Ownable(address(1)) {}

    function initialize(address _token, address _registry, address _treasurySafe, address _center, uint256 _levelId, uint256 _requiredMembers, uint256 _contributionAmount) external onlyUninitialized {
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

    function joinBlock(address member) external onlyRegistry nonReentrant {
        require(status == BlockStatus.Active, "Not active");
        require(member != address(0), "member=0");
        require(member != treasurySafe, "member=treasury");
        require(!isMember[member], "Already member");
        require(members.length < requiredMembers, "Block full");

        uint256 beforeBal = token.balanceOf(treasurySafe);
        token.safeTransferFrom(member, treasurySafe, contributionAmount);
        uint256 afterBal = token.balanceOf(treasurySafe);
        require(afterBal - beforeBal == contributionAmount, "Fee-on-transfer not supported");

        members.push(member);
        isMember[member] = true;

        emit MemberJoined(member, members.length, contributionAmount);

        if (members.length == requiredMembers) {
            status = BlockStatus.Completed;
            completedAt = block.timestamp;
            emit BlockCompleted(completedAt);
        }
    }

    function membersCount() external view returns (uint256) { return members.length; }
    function getMembers() external view returns (address[] memory) { return members; }
}

contract BlockRegistryFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public treasurySafe;
    address public platformWallet;
    address public immutable blockImplementation;

    uint256 public constant FEE_BPS = 1000;
    uint256 public constant BPS = 10000;
    uint256 public registrationFee = 20 * 1e18;

    struct LevelCfg { uint256 requiredMembers; uint256 contributionAmount; bool exists; }

    mapping(uint256 => LevelCfg) public levelCfg;
    mapping(address => uint256) public userLevel;
    mapping(address => mapping(uint256 => address)) public myBlockAtLevel;
    mapping(address => bool) public blockSettled;
    mapping(address => uint256) public inviteSlots;

    address public payoutModule;

    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PlatformWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event PayoutModuleUpdated(address indexed oldModule, address indexed newModule);
    event RegistrationPaid(address indexed user, uint256 fee, address indexed treasurySafe);
    event UserRegistered(address indexed user, address indexed referrer, uint256 startLevel);
    event SlotGranted(address indexed referrer, address indexed referrerBlock, uint256 level, uint256 newSlots);
    event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress);
    event UpgradedAndJoined(address indexed user, uint256 fromLevel, uint256 toLevel, address indexed targetBlock);
    event BlockSettled(address indexed blockAddress, address indexed center, uint256 level, bool advanced, address payoutTo);

    constructor(address _token, address _treasurySafe, address _platformWallet, address _blockImplementation) Ownable(msg.sender) {
        require(_token != address(0), "token=0");
        require(_treasurySafe != address(0), "treasury=0");
        require(_platformWallet != address(0), "platform=0");
        require(_blockImplementation != address(0), "impl=0");

        token = IERC20(_token);
        treasurySafe = _treasurySafe;
        platformWallet = _platformWallet;
        blockImplementation = _blockImplementation;

        _setLevel(1, 9, 20 * 1e18);
        _setLevel(2, 8, 50 * 1e18);
        _setLevel(3, 7, 100 * 1e18);
        _setLevel(4, 6, 250 * 1e18);
        _setLevel(5, 5, 500 * 1e18);
        _setLevel(6, 4, 1000 * 1e18);
        _setLevel(7, 3, 2500 * 1e18);
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

    function setRegistrationFee(uint256 _newFee) external onlyOwner {
        require(_newFee > 0, "fee=0");
        uint256 old = registrationFee;
        registrationFee = _newFee;
        emit RegistrationFeeUpdated(old, _newFee);
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

    function registerUser(address user, address referrer) external nonReentrant {
        require(user != address(0), "user=0");
        require(user != treasurySafe, "user=treasury");

        if (userLevel[user] == 0) {
            uint256 fee = registrationFee;
            uint256 beforeBal = token.balanceOf(treasurySafe);
            token.safeTransferFrom(user, treasurySafe, fee);
            uint256 afterBal = token.balanceOf(treasurySafe);
            require(afterBal - beforeBal == fee, "Fee-on-transfer not supported");
            userLevel[user] = 1;
            emit RegistrationPaid(user, fee, treasurySafe);
            emit UserRegistered(user, referrer, 1);
        } else {
            emit UserRegistered(user, referrer, userLevel[user]);
        }

        if (referrer != address(0)) {
            require(referrer != treasurySafe, "referrer=treasury");
            uint256 refLevel = userLevel[referrer];
            if (refLevel >= 2 && refLevel <= 7) {
                address refBlock = myBlockAtLevel[referrer][refLevel];
                if (refBlock != address(0)) {
                    inviteSlots[refBlock] += 1;
                    emit SlotGranted(referrer, refBlock, refLevel, inviteSlots[refBlock]);
                }
            }
        }
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
        CundinaBlockSecure(clone).initialize(address(token), address(this), treasurySafe, center, level, cfg.requiredMembers, cfg.contributionAmount);
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
        require(CundinaBlockSecure(prevBlock).status() == CundinaBlockSecure.BlockStatus.Completed, "prev not completed");

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

    modifier onlyPayoutModule() { require(msg.sender == payoutModule, "Only module"); _; }

    function settleReset(address blockAddr, address center, address payoutTo) external onlyPayoutModule {
        require(!blockSettled[blockAddr], "already settled");
        require(blockAddr != address(0) && center != address(0), "0");
        require(payoutTo != address(0), "payout=0");
        require(center != treasurySafe, "center=treasury");
        require(CundinaBlockSecure(blockAddr).owner() == center, "center mismatch");
        require(CundinaBlockSecure(blockAddr).status() == CundinaBlockSecure.BlockStatus.Completed, "not completed");

        blockSettled[blockAddr] = true;
        userLevel[center] = 1;

        emit BlockSettled(blockAddr, center, CundinaBlockSecure(blockAddr).levelId(), false, payoutTo);
    }

    function settleAdvance(address blockAddr, address center, address payoutTo) external onlyPayoutModule returns (address nextBlock) {
        require(!blockSettled[blockAddr], "already settled");
        require(blockAddr != address(0) && center != address(0), "0");
        require(payoutTo != address(0), "payout=0");
        require(center != treasurySafe, "center=treasury");
        require(CundinaBlockSecure(blockAddr).owner() == center, "center mismatch");
        require(CundinaBlockSecure(blockAddr).status() == CundinaBlockSecure.BlockStatus.Completed, "not completed");

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
    BlockRegistryFactory public immutable registry;
    IERC20 public immutable token;

    event CashoutExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo);
    event AdvanceExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo, address nextBlock);
    event TreasuryTransfers(uint256 gross, uint256 fee, uint256 costNext);

    constructor(address _token, address _treasurySafe, address _platformWallet, address _registry) {
        require(_token != address(0), "token=0");
        require(_treasurySafe != address(0), "treasury=0");
        require(_platformWallet != address(0), "platform=0");
        require(_registry != address(0), "registry=0");

        token = IERC20(_token);
        treasurySafe = _treasurySafe;
        platformWallet = _platformWallet;
        registry = BlockRegistryFactory(_registry);
    }

    modifier onlyTreasurySafe() { require(msg.sender == treasurySafe, "Only treasury safe"); _; }

    function cashout(address blockAddr, address center, address payoutTo) external nonReentrant onlyTreasurySafe {
        require(center != address(0), "center=0");
        require(center != treasurySafe, "center=treasury");
        require(payoutTo != address(0), "payout=0");

        uint256 gross = registry.grossForBlock(blockAddr);
        uint256 fee = registry.feeForGross(gross);
        uint256 payout = gross - fee;

        _safeTransfer(platformWallet, fee);
        _safeTransfer(payoutTo, payout);

        registry.settleReset(blockAddr, center, payoutTo);

        emit TreasuryTransfers(gross, fee, 0);
        emit CashoutExecuted(center, blockAddr, payout, payoutTo);
    }

    function advance(address blockAddr, address center, address payoutTo) external nonReentrant onlyTreasurySafe returns (address nextBlock) {
        require(center != address(0), "center=0");
        require(center != treasurySafe, "center=treasury");
        require(payoutTo != address(0), "payout=0");

        uint256 gross = registry.grossForBlock(blockAddr);
        uint256 fee = registry.feeForGross(gross);
        uint256 net = gross - fee;

        uint256 currentLevel = registry.userLevel(center);
        uint256 nextLevel = currentLevel + 1;
        uint256 costNext = registry.advanceCost(nextLevel);

        require(net >= costNext, "net < cost");
        uint256 payout = net - costNext;

        _safeTransfer(platformWallet, fee);
        _safeTransfer(platformWallet, costNext);
        _safeTransfer(payoutTo, payout);

        nextBlock = registry.settleAdvance(blockAddr, center, payoutTo);

        emit TreasuryTransfers(gross, fee, costNext);
        emit AdvanceExecuted(center, blockAddr, payout, payoutTo, nextBlock);
    }

    function _safeTransfer(address to, uint256 amount) internal {
        bytes memory data = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);
        bool ok = ISafe(treasurySafe).execTransactionFromModule(address(token), 0, data, ISafe.Operation.Call);
        require(ok, "Safe tx failed");
    }
}`;

async function compileSolidity(source: string): Promise<{
  CundinaBlockSecure: { abi: any[]; bytecode: string };
  BlockRegistryFactory: { abi: any[]; bytecode: string };
  SafeTreasuryPayoutModule: { abi: any[]; bytecode: string };
}> {
  // Import solc dynamically using esm.sh
  const solcModule = await import("https://esm.sh/solc@0.8.28");
  const solc = solcModule.default;
  
  const input = {
    language: 'Solidity',
    sources: {
      'Contracts.sol': { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const fatal = output.errors.filter((e: any) => e.severity === 'error');
    if (fatal.length) {
      throw new Error('Solidity compilation failed: ' + fatal.map((e: any) => e.formattedMessage || e.message).join('\n'));
    }
  }

  const contracts = output.contracts['Contracts.sol'];
  
  return {
    CundinaBlockSecure: {
      abi: contracts['CundinaBlockSecure'].abi,
      bytecode: '0x' + contracts['CundinaBlockSecure'].evm.bytecode.object,
    },
    BlockRegistryFactory: {
      abi: contracts['BlockRegistryFactory'].abi,
      bytecode: '0x' + contracts['BlockRegistryFactory'].evm.bytecode.object,
    },
    SafeTreasuryPayoutModule: {
      abi: contracts['SafeTreasuryPayoutModule'].abi,
      bytecode: '0x' + contracts['SafeTreasuryPayoutModule'].evm.bytecode.object,
    },
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RPC_URL = Deno.env.get('SEPOLIA_RPC_URL');
    const PRIVATE_KEY = Deno.env.get('DEPLOYER_PRIVATE_KEY');
    const PLATFORM_WALLET = Deno.env.get('PLATFORM_WALLET_ADDRESS');
    const TREASURY_SAFE = Deno.env.get('TREASURY_SAFE_ADDRESS');

    if (!RPC_URL || !PRIVATE_KEY || !PLATFORM_WALLET || !TREASURY_SAFE) {
      throw new Error('Missing required environment variables: SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, PLATFORM_WALLET_ADDRESS, TREASURY_SAFE_ADDRESS');
    }

    console.log('🚀 Compiling contracts with Solidity 0.8.28...');
    const compiled = await compileSolidity(SOLIDITY_SOURCE);
    console.log('✅ Compilation successful');

    console.log('⚙️ Connecting to Sepolia network...');
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log('Deployer:', wallet.address);
    console.log('Platform Wallet:', PLATFORM_WALLET);
    console.log('Treasury Safe:', TREASURY_SAFE);
    console.log('Token:', CUNDINA_TOKEN_ADDRESS);

    // ========== STEP 1: Deploy CundinaBlockSecure (Implementation) ==========
    console.log('\n📝 STEP 1: Deploying CundinaBlockSecure (Implementation Template)...');
    const blockFactory = new ethers.ContractFactory(compiled.CundinaBlockSecure.abi, compiled.CundinaBlockSecure.bytecode, wallet);
    const blockImpl = await blockFactory.deploy();
    await blockImpl.waitForDeployment();
    const blockImplAddress = await blockImpl.getAddress();
    console.log('✅ CundinaBlockSecure deployed to:', blockImplAddress);

    // ========== STEP 2: Deploy BlockRegistryFactory ==========
    console.log('\n📝 STEP 2: Deploying BlockRegistryFactory (Registry)...');
    const registryFactory = new ethers.ContractFactory(compiled.BlockRegistryFactory.abi, compiled.BlockRegistryFactory.bytecode, wallet);
    const registry = await registryFactory.deploy(
      CUNDINA_TOKEN_ADDRESS,
      TREASURY_SAFE,
      PLATFORM_WALLET,
      blockImplAddress
    );
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log('✅ BlockRegistryFactory deployed to:', registryAddress);

    // ========== STEP 3: Deploy SafeTreasuryPayoutModule ==========
    console.log('\n📝 STEP 3: Deploying SafeTreasuryPayoutModule...');
    const moduleFactory = new ethers.ContractFactory(compiled.SafeTreasuryPayoutModule.abi, compiled.SafeTreasuryPayoutModule.bytecode, wallet);
    const payoutModule = await moduleFactory.deploy(
      CUNDINA_TOKEN_ADDRESS,
      TREASURY_SAFE,
      PLATFORM_WALLET,
      registryAddress
    );
    await payoutModule.waitForDeployment();
    const moduleAddress = await payoutModule.getAddress();
    console.log('✅ SafeTreasuryPayoutModule deployed to:', moduleAddress);

    // ========== STEP 4: Connect Registry with Module ==========
    console.log('\n📝 STEP 4: Connecting Registry with PayoutModule...');
    const registryContract = new ethers.Contract(registryAddress, compiled.BlockRegistryFactory.abi, wallet);
    const tx = await registryContract.setPayoutModule(moduleAddress);
    await tx.wait();
    console.log('✅ PayoutModule connected to Registry');

    // ========== VERIFICATION ==========
    console.log('\n🔍 Verifying deployment...');
    const verifyRegistry = new ethers.Contract(registryAddress, compiled.BlockRegistryFactory.abi, provider);
    const verifyModule = new ethers.Contract(moduleAddress, compiled.SafeTreasuryPayoutModule.abi, provider);

    const treasuryCheck = await verifyRegistry.treasurySafe();
    const platformCheck = await verifyRegistry.platformWallet();
    const moduleCheck = await verifyRegistry.payoutModule();
    const registryCheck = await verifyModule.registry();

    console.log('Registry treasurySafe:', treasuryCheck);
    console.log('Registry platformWallet:', platformCheck);
    console.log('Registry payoutModule:', moduleCheck);
    console.log('Module registry:', registryCheck);

    // Check levels
    const level1 = await verifyRegistry.levelCfg(1);
    console.log('Level 1 config:', { members: level1[0].toString(), amount: ethers.formatEther(level1[1]), exists: level1[2] });

    return new Response(
      JSON.stringify({
        success: true,
        network: 'sepolia',
        deployer: wallet.address,
        contracts: {
          CundinaBlockSecure: blockImplAddress,
          BlockRegistryFactory: registryAddress,
          SafeTreasuryPayoutModule: moduleAddress,
        },
        configuration: {
          token: CUNDINA_TOKEN_ADDRESS,
          treasurySafe: TREASURY_SAFE,
          platformWallet: PLATFORM_WALLET,
        },
        levels: {
          level1: { members: 9, contribution: '20 USDT' },
          level2: { members: 8, contribution: '50 USDT' },
          level3: { members: 7, contribution: '100 USDT' },
          level4: { members: 6, contribution: '250 USDT' },
          level5: { members: 5, contribution: '500 USDT' },
          level6: { members: 4, contribution: '1000 USDT' },
          level7: { members: 3, contribution: '2500 USDT' },
        },
        nextStep: `⚠️ CRÍTICO: Debes habilitar el módulo en tu Safe Treasury:
1. Ir a app.safe.global
2. Seleccionar tu Safe: ${TREASURY_SAFE}
3. Settings → Modules → Add custom module
4. Pegar: ${moduleAddress}
5. Confirmar transacción`,
        envUpdates: {
          VITE_BLOCK_IMPLEMENTATION_ADDRESS: blockImplAddress,
          VITE_BLOCK_REGISTRY_ADDRESS: registryAddress,
          VITE_PAYOUT_MODULE_ADDRESS: moduleAddress,
          VITE_TREASURY_SAFE_ADDRESS: TREASURY_SAFE,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('❌ Deployment error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message, 
        details: error.stack,
        hint: 'Asegúrate de tener suficiente ETH en Sepolia para gas'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
