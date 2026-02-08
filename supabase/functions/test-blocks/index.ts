import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { ethers } from "npm:ethers@6.15.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============= Contract Addresses (V5 Sepolia) =============
const REGISTRY_ADDRESS = "0xd13e3b5b61dEb4f4D1cfdc26988875FA9022AE5E";
const USDT_ADDRESS = "0xf23cAd5D0B38ad7708E63c065C67d446aeD8c064";
const TREASURY_ADDRESS = "0x83056150CD2FDB7E1fc5286bd25Ffe0EE2EB612a";
const PAYOUT_MODULE_ADDRESS = "0x4B4A6047A7B6246FACe6A1605741e190441eaED3";

// ============= ABIs =============
const REGISTRY_ABI = [
  "function registerUser(address user, address referrer, uint256 level) external",
  "function registerAndCreateBlock(address user, address referrer, uint256 level) external returns (address)",
  "function joinLevel1(address member) external",
  "function joinTargetBlock(address member, address targetBlock) external",
  "function createMyBlock(address center) external returns (address)",
  "function userLevel(address user) external view returns (uint256)",
  "function myBlockAtLevel(address user, uint256 level) external view returns (address)",
  "function getReferralCode(address wallet) external view returns (bytes32)",
  "function referrerOf(address wallet) external view returns (address)",
  "function registrationFee(uint256 level) external view returns (uint256)",
  "function inviteSlots(address) external view returns (uint256)",
  "function findTopBlockAtLevel(uint256 level) external view returns (address topBlock, address topBlockCreator)",
  "event UserRegistered(address indexed user, address indexed referrer, uint256 level)",
  "event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress)",
  "event RegistrationPaid(address indexed user, uint256 level, uint256 fee, address indexed treasurySafe)",
];

const PAYOUT_MODULE_ABI = [
  "function advance(address blockAddr, address center, address payoutTo) external returns (address nextBlock)",
  "function cashout(address blockAddr, address center, address payoutTo) external",
  "event AdvanceExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo, address nextBlock)",
];

const BLOCK_ABI = [
  "function getMembers() external view returns (address[])",
  "function membersCount() external view returns (uint256)",
  "function status() external view returns (uint8)",
  "function owner() external view returns (address)",
  "function levelId() external view returns (uint256)",
  "function requiredMembers() external view returns (uint256)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function mint(address to, uint256 amount) external",
];

// ============= Types =============
interface TestWallet {
  id: number;
  address: string;
  private_key: string;
  is_used: boolean;
  assigned_level: number | null;
  assigned_to_wallet: string | null;
}

interface StepResult {
  step: string;
  wallet: string;
  success: boolean;
  txHash?: string;
  blockAddress?: string;
  error?: string;
  gasUsed?: string;
  details?: Record<string, unknown>;
}

// ============= Helpers =============

async function getAvailableWallets(
  supabase: ReturnType<typeof createClient>,
  count: number,
  excludeAddresses: string[] = []
): Promise<TestWallet[]> {
  const { data, error } = await supabase
    .from("test_wallets")
    .select("*")
    .eq("is_used", false)
    .order("id", { ascending: true })
    .limit(count + excludeAddresses.length + 10);

  if (error) throw new Error(`Failed to fetch wallets: ${error.message}`);

  const filtered = (data || []).filter(
    (w) => !excludeAddresses.includes(w.address.toLowerCase())
  );
  if (filtered.length < count) {
    throw new Error(`Not enough wallets. Need ${count}, found ${filtered.length}`);
  }
  return filtered.slice(0, count);
}

async function markWalletsUsed(
  supabase: ReturnType<typeof createClient>,
  walletIds: number[],
  level: number,
  assignedTo?: string
) {
  const { error } = await supabase
    .from("test_wallets")
    .update({
      is_used: true,
      assigned_level: level,
      assigned_to_wallet: assignedTo || null,
    })
    .in("id", walletIds);
  if (error) console.error("Failed to mark wallets used:", error);
}

async function ensureFunding(
  voterWallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  requiredAmount: bigint
): Promise<void> {
  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, voterWallet);
  const balance = await usdt.balanceOf(voterWallet.address);
  
  if (balance >= requiredAmount) return; // Already funded
  
  const deficit = requiredAmount - balance;
  const deployerKey = Deno.env.get("DEPLOYER_PRIVATE_KEY");
  if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY not set for funding");
  
  const deployer = new ethers.Wallet(deployerKey, provider);
  const deployerUsdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, deployer);
  
  // Try mint first (test tokens usually have public mint)
  try {
    console.log(`[funding] Minting ${ethers.formatUnits(deficit, 6)} USDT to ${voterWallet.address}...`);
    const mintTx = await deployerUsdt.mint(voterWallet.address, deficit);
    await mintTx.wait();
    console.log(`[funding] Minted successfully`);
    return;
  } catch {
    console.log(`[funding] Mint not available, trying transfer...`);
  }
  
  // Fallback: transfer from deployer
  const deployerBalance = await deployerUsdt.balanceOf(deployer.address);
  if (deployerBalance < deficit) {
    throw new Error(`Deployer has insufficient USDT: ${ethers.formatUnits(deployerBalance, 6)}, need ${ethers.formatUnits(deficit, 6)}`);
  }
  
  console.log(`[funding] Transferring ${ethers.formatUnits(deficit, 6)} USDT to ${voterWallet.address}...`);
  const tx = await deployerUsdt.transfer(voterWallet.address, deficit);
  await tx.wait();
  console.log(`[funding] Transfer successful`);
}

async function ensureApproval(wallet: ethers.Wallet): Promise<string | null> {
  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, wallet);
  const currentAllowance = await usdt.allowance(wallet.address, REGISTRY_ADDRESS);
  if (currentAllowance < ethers.parseUnits("100", 6)) {
    const tx = await usdt.approve(REGISTRY_ADDRESS, ethers.MaxUint256);
    const receipt = await tx.wait();
    return receipt.hash;
  }
  return null;
}

function parseMyBlockCreated(registry: ethers.Contract, receipt: ethers.TransactionReceipt): string | undefined {
  for (const log of receipt.logs) {
    try {
      const parsed = registry.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "MyBlockCreated") return parsed.args.blockAddress;
    } catch { /* skip */ }
  }
  return undefined;
}

// ============= Simulation State =============

interface SimState {
  phase: string;
  mainCreator: { address: string; privateKey: string; blockAddress: string } | null;
  members: Array<{ address: string; privateKey: string; blockAddress: string; l1BlockFilled: boolean; advancedToL2: boolean }>;
  l2BlockAddress: string | null;
  walletsUsed: number;
  currentMemberFillIndex: number;
  currentMemberAdvanceIndex: number;
  currentMemberJoinL2Index: number;
  currentL2VoteIndex: number;
  currentTargetVotesAdded: number;
  l2VotesAdded: number;
}

async function getSimState(supabase: ReturnType<typeof createClient>): Promise<SimState | null> {
  const { data } = await supabase
    .from("platform_config")
    .select("value")
    .eq("key", "simulation_state")
    .maybeSingle();
  return data ? JSON.parse(data.value) : null;
}

async function saveSimState(supabase: ReturnType<typeof createClient>, state: SimState) {
  const { error } = await supabase
    .from("platform_config")
    .upsert({ key: "simulation_state", value: JSON.stringify(state) }, { onConflict: "key" });
  if (error) console.error("Failed to save sim state:", error);
}

// ============= Actions =============

/**
 * ACTION: batch_register_join
 * Registers N wallets with a referrer and joins them to the referrer's L1 block.
 * Limited to 3 members per call to fit within timeout.
 */
async function actionRegisterAndJoinOne(
  provider: ethers.JsonRpcProvider,
  supabase: ReturnType<typeof createClient>,
  params: {
    referrerAddress: string;
    count?: number;
  }
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  const batchSize = Math.min(params.count || 1, 3);
  
  const memberWallets = await getAvailableWallets(supabase, batchSize, [params.referrerAddress.toLowerCase()]);
  
  // Process each wallet sequentially (nonce issues with parallel on same referrer block)
  for (const member of memberWallets) {
    const memberSigner = new ethers.Wallet(member.private_key, provider);
    const memberRegistry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, memberSigner);

    try {
      // Check if already registered
      const level = await registry.userLevel(member.address);
      if (Number(level) > 0) {
        console.log(`[reg] ${member.address} already L${level}, trying joinLevel1...`);
        await markWalletsUsed(supabase, [member.id], Number(level), params.referrerAddress);
        try {
          const joinTx = await memberRegistry.joinLevel1(member.address);
          const joinReceipt = await joinTx.wait();
          const blockAddr = parseMyBlockCreated(memberRegistry, joinReceipt);
          results.push({ step: "join", wallet: member.address, success: true, txHash: joinReceipt.hash, blockAddress: blockAddr, gasUsed: joinReceipt.gasUsed.toString() });
        } catch (joinErr: unknown) {
          const msg = joinErr instanceof Error ? joinErr.message : String(joinErr);
          results.push({ step: "join", wallet: member.address, success: false, error: msg });
        }
        continue;
      }

      // 1. Approve USDT
      console.log(`[reg] Approving ${member.address}...`);
      await ensureApproval(memberSigner);

      // 2. Register
      console.log(`[reg] Registering ${member.address} ref=${params.referrerAddress}...`);
      const regTx = await memberRegistry.registerUser(member.address, params.referrerAddress, 1);
      const regReceipt = await regTx.wait();
      console.log(`[reg] Registered. Gas: ${regReceipt.gasUsed}`);
      results.push({ step: "register", wallet: member.address, success: true, txHash: regReceipt.hash, gasUsed: regReceipt.gasUsed.toString() });

      // 3. Join Level 1
      console.log(`[reg] Joining L1...`);
      const joinTx = await memberRegistry.joinLevel1(member.address);
      const joinReceipt = await joinTx.wait();
      const memberBlockAddr = parseMyBlockCreated(memberRegistry, joinReceipt);
      console.log(`[reg] Joined! Block: ${memberBlockAddr}`);
      results.push({ step: "join", wallet: member.address, success: true, txHash: joinReceipt.hash, blockAddress: memberBlockAddr, gasUsed: joinReceipt.gasUsed.toString() });

      await markWalletsUsed(supabase, [member.id], 1, params.referrerAddress);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reg] Failed for ${member.address}:`, msg);
      await markWalletsUsed(supabase, [member.id], 0, params.referrerAddress);
      results.push({ step: "register_join_failed", wallet: member.address, success: false, error: msg });
    }
  }

  return results;
}

/**
 * ACTION: advance
 * Advance a creator whose block is completed to the next level.
 * Uses DEPLOYER_PRIVATE_KEY to send the transaction.
 */
async function actionAdvance(
  provider: ethers.JsonRpcProvider,
  params: {
    blockAddress: string;
    centerAddress: string;
    payoutTo?: string;
    signerKey?: string; // Use center's own key instead of deployer
  }
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const signerPrivateKey = params.signerKey || Deno.env.get("DEPLOYER_PRIVATE_KEY");
  if (!signerPrivateKey) {
    return [{ step: "advance", wallet: params.centerAddress, success: false, error: "No signer key available (no signerKey param and DEPLOYER_PRIVATE_KEY not set)" }];
  }

  const deployer = new ethers.Wallet(signerPrivateKey, provider);
  console.log(`[advance] Using signer: ${deployer.address} (${params.signerKey ? 'center wallet' : 'deployer'})`);
  const payoutModule = new ethers.Contract(PAYOUT_MODULE_ADDRESS, PAYOUT_MODULE_ABI, deployer);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

  // Verify block is completed
  const blockContract = new ethers.Contract(params.blockAddress, BLOCK_ABI, provider);
  const [blockStatus, membersCount, reqMembers, currentLevel] = await Promise.all([
    blockContract.status(),
    blockContract.membersCount(),
    blockContract.requiredMembers(),
    registry.userLevel(params.centerAddress),
  ]);

  console.log(`[advance] Block ${params.blockAddress}: status=${blockStatus}, members=${membersCount}/${reqMembers}, userLevel=${currentLevel}`);

  if (Number(blockStatus) !== 1) {
    return [{
      step: "advance",
      wallet: params.centerAddress,
      success: false,
      error: `Block not completed. Status: ${blockStatus}, members: ${membersCount}/${reqMembers}`,
    }];
  }

  const payoutTo = params.payoutTo || params.centerAddress;
  try {
    console.log(`[advance] Calling PayoutModule.advance(${params.blockAddress}, ${params.centerAddress}, ${payoutTo})...`);
    const tx = await payoutModule.advance(params.blockAddress, params.centerAddress, payoutTo);
    console.log(`[advance] Tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[advance] Tx confirmed! Gas: ${receipt.gasUsed}`);

    // Get new level and block
    const newLevel = await registry.userLevel(params.centerAddress);
    const newBlock = await registry.myBlockAtLevel(params.centerAddress, Number(newLevel));

    results.push({
      step: "advance",
      wallet: params.centerAddress,
      success: true,
      txHash: receipt.hash,
      blockAddress: newBlock !== ethers.ZeroAddress ? newBlock : undefined,
      gasUsed: receipt.gasUsed.toString(),
      details: {
        previousLevel: Number(currentLevel),
        newLevel: Number(newLevel),
        newBlockAddress: newBlock,
      },
    });

    // V5: After advance, join the TOP block at the new level
    try {
      const [topBlock, topBlockCreator] = await registry.findTopBlockAtLevel(Number(newLevel));
      if (topBlock !== ethers.ZeroAddress && topBlock.toLowerCase() !== newBlock.toLowerCase()) {
        console.log(`[advance] Joining TOP block ${topBlock} (creator: ${topBlockCreator}) at L${newLevel}...`);
        const deployerRegistry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, deployer);
        const joinTx = await deployerRegistry.joinTargetBlock(params.centerAddress, topBlock);
        const joinReceipt = await joinTx.wait();
        console.log(`[advance] Joined TOP block! Gas: ${joinReceipt.gasUsed}`);
        results.push({
          step: "join_target_block",
          wallet: params.centerAddress,
          success: true,
          txHash: joinReceipt.hash,
          blockAddress: topBlock,
          gasUsed: joinReceipt.gasUsed.toString(),
          details: { topBlockCreator, level: Number(newLevel) },
        });
      } else if (topBlock === ethers.ZeroAddress) {
        console.log(`[advance] No TOP block available at level ${newLevel}`);
        results.push({ step: "join_target_block", wallet: params.centerAddress, success: true, details: { message: `No TOP block at L${newLevel}, user is first at this level` } });
      } else {
        console.log(`[advance] TOP block is user's own block, skipping join`);
      }
    } catch (joinErr: unknown) {
      const joinMsg = joinErr instanceof Error ? joinErr.message : String(joinErr);
      console.warn(`[advance] joinTargetBlock failed (non-fatal):`, joinMsg);
      results.push({ step: "join_target_block", wallet: params.centerAddress, success: false, error: joinMsg });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[advance] Failed:", msg);
    results.push({ step: "advance", wallet: params.centerAddress, success: false, error: msg });
  }

  return results;
}

/**
 * ACTION: simulate
 * Automated L1→L2 simulation. Runs one phase at a time, saving state between calls.
 * Call repeatedly until phase = "done".
 */
async function actionSimulate(
  provider: ethers.JsonRpcProvider,
  supabase: ReturnType<typeof createClient>,
  params: { reset?: boolean }
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  const TIME_BUDGET_MS = 50000; // 50s budget (edge fn timeout ~60s)
  const startTime = Date.now();

  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startTime);

  if (params.reset) {
    await saveSimState(supabase, {
      phase: "create_main_creator",
      mainCreator: null,
      members: [],
      l2BlockAddress: null,
      walletsUsed: 0,
      currentMemberFillIndex: 0,
      currentMemberAdvanceIndex: 0,
      currentMemberJoinL2Index: 0,
      currentL2VoteIndex: 0,
      currentTargetVotesAdded: 0,
      l2VotesAdded: 0,
    });
    results.push({ step: "reset", wallet: "N/A", success: true, details: { message: "Simulation reset." } });
    return results;
  }

  let state = await getSimState(supabase);
  if (!state) {
    state = {
      phase: "create_main_creator",
      mainCreator: null,
      members: [],
      l2BlockAddress: null,
      walletsUsed: 0,
      currentMemberFillIndex: 0,
      currentMemberAdvanceIndex: 0,
      currentMemberJoinL2Index: 0,
      currentL2VoteIndex: 0,
      currentTargetVotesAdded: 0,
      l2VotesAdded: 0,
    };
  }
  // Ensure backwards compatibility with older state
  if (state.currentTargetVotesAdded === undefined) {
    state.currentTargetVotesAdded = 0;
  }

  // ============= Continuation logic: if "done" but work remains =============
  if (state.phase === "done") {
    const unAdvancedMembers = state.members.filter(m => m.l1BlockFilled && !m.advancedToL2);
    const { count: availableCount } = await supabase
      .from("test_wallets")
      .select("id", { count: "exact", head: true })
      .eq("is_used", false);

    if (unAdvancedMembers.length > 0) {
      console.log(`[sim] Continuation: ${unAdvancedMembers.length} un-advanced members found, retrying advances...`);
      state.phase = "advance_members";
      state.currentMemberAdvanceIndex = 0; // restart from beginning, already-advanced will be skipped
      await saveSimState(supabase, state);
      results.push({
        step: "continuation_detected",
        wallet: "N/A",
        success: true,
        details: {
          message: `Found ${unAdvancedMembers.length} members with filled blocks but not advanced. Retrying...`,
          availableWallets: availableCount,
          unAdvancedIndices: state.members.map((m, i) => (!m.advancedToL2 && m.l1BlockFilled) ? i : null).filter(i => i !== null),
        },
      });
    } else if ((availableCount || 0) > 0) {
      console.log(`[sim] Continuation: ${availableCount} wallets available, adding more L2 votes...`);
      state.phase = "add_l2_votes";
      state.currentL2VoteIndex = 0;
      state.currentTargetVotesAdded = 0;
      await saveSimState(supabase, state);
      results.push({
        step: "continuation_votes",
        wallet: "N/A",
        success: true,
        details: {
          message: `All members advanced. Using ${availableCount} remaining wallets for more L2 votes.`,
          availableWallets: availableCount,
        },
      });
    } else {
      results.push({
        step: "simulation_fully_complete",
        wallet: state.mainCreator?.address || "N/A",
        success: true,
        details: {
          message: "✅ Simulation fully complete. No un-advanced members, no wallets remaining.",
          walletsUsed: state.walletsUsed,
          l2VotesAdded: state.l2VotesAdded,
          membersAdvanced: state.members.filter(m => m.advancedToL2).length,
          membersTotal: state.members.length,
        },
      });
      return results;
    }
  }

  // Main loop: keep processing phases while time allows
  while (timeLeft() > 15000 && state.phase !== "done") {
    console.log(`[sim] Phase: ${state.phase}, time left: ${Math.round(timeLeft()/1000)}s, wallets: ${state.walletsUsed}`);

    switch (state.phase) {
      // ============= Phase 1: Create main creator =============
      case "create_main_creator": {
        const wallets = await getAvailableWallets(supabase, 1);
        const creatorWallet = wallets[0];
        const signer = new ethers.Wallet(creatorWallet.private_key, provider);
        const creatorRegistry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);

        const level = await registry.userLevel(creatorWallet.address);
        if (Number(level) > 0) {
          const blockAddr = await registry.myBlockAtLevel(creatorWallet.address, Number(level));
          state.mainCreator = { address: creatorWallet.address, privateKey: creatorWallet.private_key, blockAddress: blockAddr };
          state.phase = "fill_main_block";
          state.walletsUsed++;
          await markWalletsUsed(supabase, [creatorWallet.id], Number(level));
          await saveSimState(supabase, state);
          results.push({ step: "creator_exists", wallet: creatorWallet.address, success: true, blockAddress: blockAddr });
          continue;
        }

        console.log(`[sim] Creating creator: ${creatorWallet.address}`);
        await ensureApproval(signer);
        const tx = await creatorRegistry.registerAndCreateBlock(creatorWallet.address, ethers.ZeroAddress, 1);
        const receipt = await tx.wait();
        const blockAddr = parseMyBlockCreated(creatorRegistry, receipt) || "";

        state.mainCreator = { address: creatorWallet.address, privateKey: creatorWallet.private_key, blockAddress: blockAddr };
        state.phase = "fill_main_block";
        state.walletsUsed++;
        await markWalletsUsed(supabase, [creatorWallet.id], 1);
        await saveSimState(supabase, state);
        results.push({ step: "creator_created", wallet: creatorWallet.address, success: true, txHash: receipt.hash, blockAddress: blockAddr });
        continue;
      }

      // ============= Phase 2: Fill main L1 block (1 member per iteration) =============
      case "fill_main_block": {
        if (!state.mainCreator) { results.push({ step: "error", wallet: "N/A", success: false, error: "No creator" }); return results; }

        const blockContract = new ethers.Contract(state.mainCreator.blockAddress, BLOCK_ABI, provider);
        const [currentMembers, reqMembers] = await Promise.all([
          blockContract.membersCount(),
          blockContract.requiredMembers(),
        ]);
        const remaining = Number(reqMembers) - Number(currentMembers);

        if (remaining <= 0) {
          state.phase = "advance_main_creator";
          await saveSimState(supabase, state);
          results.push({ step: "main_block_full", wallet: state.mainCreator.address, success: true, details: { members: Number(currentMembers) } });
          continue;
        }

        const memberResults = await actionRegisterAndJoinOne(provider, supabase, { referrerAddress: state.mainCreator.address });
        results.push(...memberResults);

        // Track joined member
        const joinResult = memberResults.find(r => r.step === "join" && r.success);
        if (joinResult?.blockAddress) {
          state.members.push({
            address: joinResult.wallet,
            privateKey: "",
            blockAddress: joinResult.blockAddress,
            l1BlockFilled: false,
            advancedToL2: false,
          });
        }
        state.walletsUsed++;
        await saveSimState(supabase, state);

        results.push({ step: "fill_progress", wallet: state.mainCreator.address, success: true, details: { filled: Number(currentMembers) + 1, required: Number(reqMembers), walletsUsed: state.walletsUsed } });
        continue;
      }

      // ============= Phase 3: Advance main creator to L2 =============
      case "advance_main_creator": {
        if (!state.mainCreator) { results.push({ step: "error", wallet: "N/A", success: false, error: "No creator" }); return results; }

        const advResults = await actionAdvance(provider, {
          blockAddress: state.mainCreator.blockAddress,
          centerAddress: state.mainCreator.address,
          signerKey: state.mainCreator.privateKey,
        });
        results.push(...advResults);

        if (advResults[0]?.success) {
          const newBlock = advResults[0].details?.newBlockAddress as string;
          state.l2BlockAddress = newBlock || null;
          state.phase = "fill_member_blocks";
          state.currentMemberFillIndex = 0;
          console.log(`[sim] Creator advanced to L2! Block: ${newBlock}`);
        }
        await saveSimState(supabase, state);
        continue;
      }

      // ============= Phase 4: Fill member L1 blocks (1 sub-member per iteration) =============
      case "fill_member_blocks": {
        // Check if all 9 member blocks done (only first 8 need to advance for L2)
        if (state.currentMemberFillIndex >= state.members.length) {
          state.phase = "advance_members";
          state.currentMemberAdvanceIndex = 0;
          await saveSimState(supabase, state);
          results.push({ step: "all_member_blocks_filled", wallet: "N/A", success: true });
          continue;
        }

        const memberIdx = state.currentMemberFillIndex;
        const member = state.members[memberIdx];

        // Get block address from chain if missing
        let blockAddr = member.blockAddress;
        if (!blockAddr || blockAddr === ethers.ZeroAddress) {
          blockAddr = await registry.myBlockAtLevel(member.address, 1);
          state.members[memberIdx].blockAddress = blockAddr;
        }

        if (!blockAddr || blockAddr === ethers.ZeroAddress) {
          console.log(`[sim] Member ${memberIdx} has no block, skipping`);
          state.currentMemberFillIndex++;
          await saveSimState(supabase, state);
          continue;
        }

        const blockContract = new ethers.Contract(blockAddr, BLOCK_ABI, provider);
        const [currentMembers, reqMembers] = await Promise.all([
          blockContract.membersCount(),
          blockContract.requiredMembers(),
        ]);
        const remaining = Number(reqMembers) - Number(currentMembers);

        if (remaining <= 0) {
          state.members[memberIdx].l1BlockFilled = true;
          state.currentMemberFillIndex++;
          await saveSimState(supabase, state);
          results.push({ step: `member_${memberIdx}_block_full`, wallet: member.address, success: true, blockAddress: blockAddr });
          continue;
        }

        // Register up to 2 members at once to speed up filling
        const memberResults = await actionRegisterAndJoinOne(provider, supabase, { referrerAddress: member.address, count: 1 });
        results.push(...memberResults);
        const successfulJoins = memberResults.filter(r => r.step === "join" && r.success).length;
        state.walletsUsed += Math.max(successfulJoins, memberResults.filter(r => r.step !== "fill_progress").length > 0 ? 1 : 0);

        const newCount = await blockContract.membersCount();
        if (Number(newCount) >= Number(reqMembers)) {
          state.members[memberIdx].l1BlockFilled = true;
          state.currentMemberFillIndex++;
          console.log(`[sim] Member ${memberIdx} block filled!`);
        }
        await saveSimState(supabase, state);
        results.push({ step: `fill_member_${memberIdx}`, wallet: member.address, success: true, details: { filled: Number(newCount), required: Number(reqMembers), memberIdx, totalProgress: `${state.currentMemberFillIndex}/${state.members.length}` } });
        continue;
      }

      // ============= Phase 5: Advance members to L2 (1 per iteration) =============
      case "advance_members": {
        if (state.currentMemberAdvanceIndex >= state.members.length) {
          state.phase = "join_l2_block";
          state.currentMemberJoinL2Index = 0;
          await saveSimState(supabase, state);
          results.push({ step: "all_members_advanced", wallet: "N/A", success: true });
          continue;
        }

        const memberIdx = state.currentMemberAdvanceIndex;
        const member = state.members[memberIdx];
        if (!member?.l1BlockFilled) {
          console.log(`[sim] Member ${memberIdx} block not filled, skipping advance`);
          state.currentMemberAdvanceIndex++;
          await saveSimState(supabase, state);
          continue;
        }

        // Check if member is already at L2+ (already advanced in a previous run)
        const memberLevel = await registry.userLevel(member.address);
        if (Number(memberLevel) >= 2) {
          console.log(`[sim] Member ${memberIdx} already at L${memberLevel}, skipping advance`);
          state.members[memberIdx].advancedToL2 = true;
          state.currentMemberAdvanceIndex++;
          await saveSimState(supabase, state);
          results.push({ step: "member_already_advanced", wallet: member.address, success: true, details: { memberIdx, level: Number(memberLevel) } });
          continue;
        }

        const advResults = await actionAdvance(provider, {
          blockAddress: member.blockAddress,
          centerAddress: member.address,
          signerKey: member.privateKey,
        });
        results.push(...advResults);

        if (advResults[0]?.success) {
          state.members[memberIdx].advancedToL2 = true;
          state.currentMemberAdvanceIndex++;
          console.log(`[sim] Member ${memberIdx} advanced to L2!`);
        } else {
          // If advance fails (e.g. "already settled"), skip to avoid infinite loop
          const errorMsg = advResults[0]?.error || "";
          if (errorMsg.includes("already settled")) {
            console.warn(`[sim] Member ${memberIdx} block already settled, marking as advanced`);
            state.members[memberIdx].advancedToL2 = true;
            state.currentMemberAdvanceIndex++;
          } else {
            // For other errors, also skip to prevent infinite retry
            console.error(`[sim] Member ${memberIdx} advance failed, skipping: ${errorMsg}`);
            state.currentMemberAdvanceIndex++;
          }
        }
        await saveSimState(supabase, state);
        continue;
      }

      // ============= Phase 6: Members join creator's L2 block =============
      case "join_l2_block": {
        if (!state.l2BlockAddress || !state.mainCreator) {
          results.push({ step: "error", wallet: "N/A", success: false, error: "No L2 block" });
          return results;
        }

        if (state.currentMemberJoinL2Index >= state.members.length) {
          state.phase = "add_l2_votes";
          state.currentL2VoteIndex = 0;
          state.l2VotesAdded = state.l2VotesAdded || 0;
          await saveSimState(supabase, state);
          results.push({
            step: "all_members_joined_l2",
            wallet: state.mainCreator.address,
            success: true,
            details: {
              message: "All members joined L2 block. Now adding L2 votes...",
              l2BlockAddress: state.l2BlockAddress,
            },
          });
          continue;
        }

        const memberIdx = state.currentMemberJoinL2Index;
        const member = state.members[memberIdx];
        if (!member?.advancedToL2) {
          state.currentMemberJoinL2Index++;
          await saveSimState(supabase, state);
          continue;
        }

        const { data: memberWallet } = await supabase
          .from("test_wallets")
          .select("private_key")
          .ilike("address", member.address)
          .maybeSingle();

        if (!memberWallet) {
          state.currentMemberJoinL2Index++;
          await saveSimState(supabase, state);
          continue;
        }

        try {
          const memberSigner = new ethers.Wallet(memberWallet.private_key, provider);
          const memberRegistry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, memberSigner);
          console.log(`[sim] Member ${memberIdx} joining L2 block...`);
          const tx = await memberRegistry.joinTargetBlock(member.address, state.l2BlockAddress);
          const receipt = await tx.wait();
          state.currentMemberJoinL2Index++;
          await saveSimState(supabase, state);
          results.push({ step: `join_l2_${memberIdx}`, wallet: member.address, success: true, txHash: receipt.hash });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ step: `join_l2_${memberIdx}`, wallet: member.address, success: false, error: msg });
          state.currentMemberJoinL2Index++;
          await saveSimState(supabase, state);
        }
        continue;
      }

      // ============= Phase 7: Add L2 votes (register new wallets at L2 with members as referrers) =============
      case "add_l2_votes": {
        // Build list of L2 targets: main creator + all advanced members
        const l2Targets: string[] = [];
        if (state.mainCreator) {
          l2Targets.push(state.mainCreator.address);
        }
        for (const m of state.members) {
          if (m.advancedToL2) {
            l2Targets.push(m.address);
          }
        }

        if (state.currentL2VoteIndex >= l2Targets.length) {
          state.phase = "done";
          await saveSimState(supabase, state);
          results.push({
            step: "simulation_complete",
            wallet: state.mainCreator?.address || "N/A",
            success: true,
            details: {
              message: "🎉 L2 simulation complete with votes!",
              mainCreator: state.mainCreator?.address,
              l2BlockAddress: state.l2BlockAddress,
              walletsUsed: state.walletsUsed,
              l2VotesAdded: state.l2VotesAdded,
            },
          });
          continue;
        }

        const targetIdx = state.currentL2VoteIndex;
        const targetAddress = l2Targets[targetIdx];

        // Verify target is at L2
        const targetLevel = await registry.userLevel(targetAddress);
        if (Number(targetLevel) < 2) {
          console.log(`[l2votes] Target ${targetAddress} not at L2 (L${targetLevel}), skipping`);
          state.currentL2VoteIndex++;
          state.currentTargetVotesAdded = 0;
          await saveSimState(supabase, state);
          continue;
        }

        // Get required members for the target's L2 block to know how many votes to add
        const targetBlock = await registry.myBlockAtLevel(targetAddress, Number(targetLevel));
        let votesNeeded = 8; // default for L2
        if (targetBlock && targetBlock !== ethers.ZeroAddress) {
          try {
            const blockContract = new ethers.Contract(targetBlock, BLOCK_ABI, provider);
            votesNeeded = Number(await blockContract.requiredMembers());
          } catch {
            console.warn(`[l2votes] Could not read requiredMembers for ${targetBlock}, using default ${votesNeeded}`);
          }
        }

        // Check if we've added enough votes for this target
        if (state.currentTargetVotesAdded >= votesNeeded) {
          console.log(`[l2votes] Target ${targetIdx} has ${state.currentTargetVotesAdded}/${votesNeeded} votes, moving to next`);
          state.currentL2VoteIndex++;
          state.currentTargetVotesAdded = 0;
          await saveSimState(supabase, state);
          results.push({
            step: `target_${targetIdx}_votes_complete`,
            wallet: targetAddress,
            success: true,
            details: { votesAdded: state.currentTargetVotesAdded, votesNeeded, targetName: targetIdx === 0 ? "creator" : `member_${targetIdx - 1}` },
          });
          continue;
        }

        // Get a new wallet for the vote
        const excludeAddrs = [targetAddress.toLowerCase()];
        if (state.mainCreator) excludeAddrs.push(state.mainCreator.address.toLowerCase());
        for (const m of state.members) excludeAddrs.push(m.address.toLowerCase());

        let voterWallets: TestWallet[];
        try {
          voterWallets = await getAvailableWallets(supabase, 1, excludeAddrs);
        } catch {
          console.warn(`[l2votes] No more wallets available, finishing votes phase`);
          state.phase = "done";
          await saveSimState(supabase, state);
          results.push({ step: "l2_votes_no_wallets", wallet: "N/A", success: true, details: { l2VotesAdded: state.l2VotesAdded } });
          continue;
        }

        const voterWallet = voterWallets[0];
        const voterSigner = new ethers.Wallet(voterWallet.private_key, provider);
        const voterRegistry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, voterSigner);

        try {
          // Check if voter already registered
          const voterLevel = await registry.userLevel(voterWallet.address);
          if (Number(voterLevel) > 0) {
            console.log(`[l2votes] Voter ${voterWallet.address} already L${voterLevel}, skipping wallet`);
            state.walletsUsed++;
            await markWalletsUsed(supabase, [voterWallet.id], Number(voterLevel), targetAddress);
            await saveSimState(supabase, state);
            continue;
          }

          // 1. Approve USDT (wallets already have 20 USDT, enough for L1 registration)
          console.log(`[l2votes] Approving ${voterWallet.address}...`);
          await ensureApproval(voterSigner);

          // 2. Register at L1 with target as referrer (20 USDT - adds vote to referrer's block)
          console.log(`[l2votes] Registering ${voterWallet.address} at L1 ref=${targetAddress} (vote ${state.currentTargetVotesAdded + 1}/${votesNeeded})...`);
          const tx = await voterRegistry.registerAndCreateBlock(voterWallet.address, targetAddress, 1);
          const receipt = await tx.wait();
          const blockAddr = parseMyBlockCreated(voterRegistry, receipt);
          console.log(`[l2votes] Registered! Gas: ${receipt.gasUsed}, Block: ${blockAddr}`);

          state.currentTargetVotesAdded++;
          state.l2VotesAdded = (state.l2VotesAdded || 0) + 1;
          state.walletsUsed++;
          await markWalletsUsed(supabase, [voterWallet.id], 1, targetAddress);
          await saveSimState(supabase, state);

          results.push({
            step: `l2_vote_${targetIdx}`,
            wallet: voterWallet.address,
            success: true,
            txHash: receipt.hash,
            blockAddress: blockAddr,
            gasUsed: receipt.gasUsed.toString(),
            details: {
              referrer: targetAddress,
              targetIdx,
              targetName: targetIdx === 0 ? "creator" : `member_${targetIdx - 1}`,
              voteProgress: `${state.currentTargetVotesAdded}/${votesNeeded}`,
            },
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[l2votes] Failed for ${voterWallet.address}:`, msg);
          // Count as a vote attempt to avoid infinite loop on persistent errors
          state.currentTargetVotesAdded++;
          state.walletsUsed++;
          await markWalletsUsed(supabase, [voterWallet.id], 0, targetAddress);
          await saveSimState(supabase, state);
          results.push({
            step: `l2_vote_${targetIdx}`,
            wallet: voterWallet.address,
            success: false,
            error: msg,
            details: { referrer: targetAddress, voteProgress: `${state.currentTargetVotesAdded}/${votesNeeded}` },
          });
        }
        continue;
      }

      default:
        results.push({ step: "error", wallet: "N/A", success: false, error: `Unknown phase: ${state.phase}` });
        return results;
    }
  }

  // Final status
  results.push({
    step: "sim_status",
    wallet: state.mainCreator?.address || "N/A",
    success: true,
    details: {
      phase: state.phase,
      walletsUsed: state.walletsUsed,
      membersTracked: state.members.length,
      membersFilled: state.members.filter(m => m.l1BlockFilled).length,
      membersAdvanced: state.members.filter(m => m.advancedToL2).length,
      l2VotesAdded: state.l2VotesAdded || 0,
      timeElapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
    },
  });

  return results;
}

/**
 * ACTION: check_status - Read on-chain state for a wallet.
 */
async function actionCheckStatus(
  provider: ethers.JsonRpcProvider,
  params: { walletAddress: string }
): Promise<StepResult[]> {
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);

  const [level, refCode, referrer, usdtBal, ethBal] = await Promise.all([
    registry.userLevel(params.walletAddress),
    registry.getReferralCode(params.walletAddress),
    registry.referrerOf(params.walletAddress),
    usdt.balanceOf(params.walletAddress),
    provider.getBalance(params.walletAddress),
  ]);

  let blockDetails: Record<string, unknown> = {};
  if (Number(level) > 0) {
    const blockAtLevel = await registry.myBlockAtLevel(params.walletAddress, Number(level));
    if (blockAtLevel !== ethers.ZeroAddress) {
      const blockContract = new ethers.Contract(blockAtLevel, BLOCK_ABI, provider);
      const [mc, bs, rm] = await Promise.all([
        blockContract.membersCount(),
        blockContract.status(),
        blockContract.requiredMembers(),
      ]);
      blockDetails = {
        blockAddress: blockAtLevel,
        membersCount: Number(mc),
        requiredMembers: Number(rm),
        status: Number(bs) === 0 ? "Active" : "Completed",
      };
    }
  }

  return [{
    step: "check_status",
    wallet: params.walletAddress,
    success: true,
    details: {
      level: Number(level),
      referralCode: refCode !== ethers.ZeroHash ? refCode : null,
      referrer: referrer !== ethers.ZeroAddress ? referrer : null,
      balance: { usdt: ethers.formatUnits(usdtBal, 6), eth: ethers.formatEther(ethBal) },
      block: blockDetails,
    },
  }];
}

/**
 * ACTION: wallet_stats
 */
/**
 * ACTION: join_top_block
 * Join a member (already at level N) to the TOP block at that level via findTopBlockAtLevel + joinTargetBlock.
 * Can process multiple members in one call.
 */
async function actionJoinTopBlock(
  provider: ethers.JsonRpcProvider,
  params: { memberAddresses: string[] }
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const deployerKey = Deno.env.get("DEPLOYER_PRIVATE_KEY");
  if (!deployerKey) {
    return [{ step: "join_top_block", wallet: "N/A", success: false, error: "DEPLOYER_PRIVATE_KEY not set" }];
  }

  const deployer = new ethers.Wallet(deployerKey, provider);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, deployer);

  for (const memberAddr of params.memberAddresses) {
    try {
      const level = await registry.userLevel(memberAddr);
      const memberLevel = Number(level);
      console.log(`[join_top] ${memberAddr} is L${memberLevel}`);

      if (memberLevel < 2) {
        results.push({ step: "join_top_block", wallet: memberAddr, success: false, error: `User level ${memberLevel} < 2, nothing to join` });
        continue;
      }

      // Find TOP block at this level
      const [topBlock, topBlockCreator] = await registry.findTopBlockAtLevel(memberLevel);
      if (topBlock === ethers.ZeroAddress) {
        results.push({ step: "join_top_block", wallet: memberAddr, success: false, error: `No TOP block at L${memberLevel}` });
        continue;
      }

      // Check if member's own block is the TOP block (skip self-join)
      const myBlock = await registry.myBlockAtLevel(memberAddr, memberLevel);
      if (myBlock.toLowerCase() === topBlock.toLowerCase()) {
        results.push({ step: "join_top_block", wallet: memberAddr, success: true, details: { message: `Own block IS the TOP block at L${memberLevel}, skipping` } });
        continue;
      }

      // Check if already a member of the TOP block
      const blockContract = new ethers.Contract(topBlock, BLOCK_ABI, provider);
      try {
        const members = await blockContract.getMembers();
        const isMember = (members as string[]).some(m => m.toLowerCase() === memberAddr.toLowerCase());
        if (isMember) {
          results.push({ step: "join_top_block", wallet: memberAddr, success: true, details: { message: `Already member of TOP block ${topBlock}` } });
          continue;
        }
      } catch { /* getMembers might fail, proceed anyway */ }

      console.log(`[join_top] Joining ${memberAddr} to TOP block ${topBlock} (creator: ${topBlockCreator}) at L${memberLevel}...`);
      const tx = await registry.joinTargetBlock(memberAddr, topBlock);
      const receipt = await tx.wait();
      console.log(`[join_top] Joined! Gas: ${receipt.gasUsed}`);

      results.push({
        step: "join_top_block",
        wallet: memberAddr,
        success: true,
        txHash: receipt.hash,
        blockAddress: topBlock,
        gasUsed: receipt.gasUsed.toString(),
        details: { topBlockCreator, level: memberLevel },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[join_top] Failed for ${memberAddr}:`, msg);
      results.push({ step: "join_top_block", wallet: memberAddr, success: false, error: msg });
    }
  }

  return results;
}

async function actionWalletStats(supabase: ReturnType<typeof createClient>): Promise<StepResult[]> {
  const { count: total } = await supabase.from("test_wallets").select("id", { count: "exact", head: true });
  const { count: available } = await supabase.from("test_wallets").select("id", { count: "exact", head: true }).eq("is_used", false);
  const { count: used } = await supabase.from("test_wallets").select("id", { count: "exact", head: true }).eq("is_used", true);

  const simState = await getSimState(supabase);

  return [{
    step: "wallet_stats",
    wallet: "N/A",
    success: true,
    details: {
      totalWallets: total,
      availableWallets: available,
      usedWallets: used,
      simulationPhase: simState?.phase || "not_started",
      simulationWalletsUsed: simState?.walletsUsed || 0,
      simulationMembersTracked: simState?.members?.length || 0,
    },
  }];
}

/**
 * ACTION: reset_wallets
 */
async function actionResetWallets(
  supabase: ReturnType<typeof createClient>,
  params: { resetAll?: boolean }
): Promise<StepResult[]> {
  if (params.resetAll) {
    const { error } = await supabase
      .from("test_wallets")
      .update({ is_used: false, assigned_level: 0, assigned_to_wallet: null })
      .eq("is_used", true);

    // Also clear simulation state
    await supabase.from("platform_config").delete().eq("key", "simulation_state");

    return [{ step: "reset_all", wallet: "N/A", success: !error, error: error?.message }];
  }

  return [{ step: "reset", wallet: "N/A", success: false, error: "Set resetAll: true" }];
}

// ============= Main Handler =============

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rpcUrl = Deno.env.get("SEPOLIA_RPC_URL") || "https://eth-sepolia.g.alchemy.com/v2/demo";
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    if (!action) {
      return new Response(
        JSON.stringify({
          error: "Missing 'action'",
          availableActions: [
            "simulate - Automated L1→L2 simulation (call repeatedly until phase=done)",
            "advance - Advance a completed block to next level",
            "join_top_block - Join L2+ members to TOP block {memberAddresses: [addr1, addr2]}",
            "batch_register_join - Register N wallets and join referrer's block",
            "check_status - Check wallet on-chain status",
            "wallet_stats - Show wallet availability + simulation progress",
            "reset_wallets - Reset all wallets and simulation state",
          ],
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let results: StepResult[] = [];
    const startTime = Date.now();
    console.log(`[test-blocks] Action: ${action}`, JSON.stringify(body));

    switch (action) {
      case "simulate":
        results = await actionSimulate(provider, supabase, { reset: body.reset });
        break;
      case "advance":
        if (!body.blockAddress || !body.centerAddress)
          return new Response(JSON.stringify({ error: "Need blockAddress and centerAddress" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        results = await actionAdvance(provider, body);
        break;
      case "register_join_one":
        if (!body.referrerAddress)
          return new Response(JSON.stringify({ error: "Need referrerAddress" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        results = await actionRegisterAndJoinOne(provider, supabase, body);
        break;
      case "check_status":
        if (!body.walletAddress)
          return new Response(JSON.stringify({ error: "Need walletAddress" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        results = await actionCheckStatus(provider, body);
        break;
      case "wallet_stats":
        results = await actionWalletStats(supabase);
        break;
      case "reset_wallets":
        results = await actionResetWallets(supabase, body);
        break;
      case "join_top_block":
        if (!body.memberAddresses || !Array.isArray(body.memberAddresses))
          return new Response(JSON.stringify({ error: "Need memberAddresses array" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        results = await actionJoinTopBlock(provider, body);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const duration = Date.now() - startTime;
    return new Response(
      JSON.stringify({
        action,
        success: results.every((r) => r.success),
        duration: `${duration}ms`,
        stepsCompleted: results.filter((r) => r.success).length,
        totalSteps: results.length,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[test-blocks] Error:", error);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
