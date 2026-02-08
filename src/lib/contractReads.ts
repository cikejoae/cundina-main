 // Contract read helpers for on-chain data
 import { parseAbi, formatUnits, type Address } from "viem";
 import { CONTRACTS, USDT_TOKEN_ADDRESS } from "@/config/contracts";
 
 export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
 
 // ABIs for read operations
 export const REGISTRY_READ_ABI = parseAbi([
   "function userLevel(address user) external view returns (uint256)",
   "function myBlockAtLevel(address user, uint256 level) external view returns (address)",
   "function inviteSlots(address user) external view returns (uint256)",
   "function registrationFee(uint256 level) external view returns (uint256)",
   // New functions (after contract upgrade)
   "function resolveReferralCode(bytes32 code) external view returns (address)",
   "function getReferralCode(address wallet) external view returns (bytes32)",
   "function getReferrer(address wallet) external view returns (address)",
   "function getAllUserBlocks(address user) external view returns (address[] memory)",
   "function getInvitedCount(address blockAddr) external view returns (uint256)",
 ]);
 
 export const BLOCK_READ_ABI = parseAbi([
   "function owner() external view returns (address)",
   "function levelId() external view returns (uint256)",
   "function requiredMembers() external view returns (uint256)",
   "function membersCount() external view returns (uint256)",
   "function getMembers() external view returns (address[] memory)",
   "function contributionAmount() external view returns (uint256)",
   "function status() external view returns (uint8)",
   "function createdAt() external view returns (uint256)",
   "function completedAt() external view returns (uint256)",
   "function registry() external view returns (address)",
 ]);
 
 export const ERC20_READ_ABI = parseAbi([
   "function balanceOf(address account) view returns (uint256)",
   "function decimals() view returns (uint8)",
 ]);
 
 // ============= Block Data Types =============
 
 export interface OnChainBlockData {
   address: Address;
   owner: Address;
   levelId: number;
   requiredMembers: number;
   membersCount: number;
   members: Address[];
   contributionAmount: bigint;
   status: number; // 0 = Active, 1 = Completed
   createdAt: number;
   completedAt: number;
   registry: Address;
   invitedCount?: number;
 }
 
 export interface OnChainUserData {
   address: Address;
   level: number;
   inviteSlots: number;
   referralCode?: string;
   referrer?: Address;
   blocks: Address[];
 }
 
 // ============= Read Functions =============
 
 /**
  * Read user level from Registry contract
  */
 export async function readUserLevel(
   publicClient: any,
   userAddress: Address
 ): Promise<number> {
   try {
     const level = await publicClient.readContract({
       address: CONTRACTS.REGISTRY as Address,
       abi: REGISTRY_READ_ABI,
       functionName: "userLevel",
       args: [userAddress],
     });
     return Number(level);
   } catch (error) {
     console.warn("[contractReads] readUserLevel failed:", error);
     return 0;
   }
 }
 
 /**
  * Read user's block at a specific level
  */
 export async function readMyBlockAtLevel(
   publicClient: any,
   userAddress: Address,
   level: number
 ): Promise<Address | null> {
   try {
     const blockAddr = await publicClient.readContract({
       address: CONTRACTS.REGISTRY as Address,
       abi: REGISTRY_READ_ABI,
       functionName: "myBlockAtLevel",
       args: [userAddress, BigInt(level)],
     });
     const addr = String(blockAddr) as Address;
     return addr !== ZERO_ADDRESS ? addr : null;
   } catch (error) {
     console.warn("[contractReads] readMyBlockAtLevel failed:", error);
     return null;
   }
 }
 
 /**
  * Read all blocks for a user (levels 1-7)
  */
 export async function readAllUserBlocks(
   publicClient: any,
   userAddress: Address
 ): Promise<Address[]> {
   const blocks: Address[] = [];
   
   // Try new getAllUserBlocks function first
   try {
     const result = await publicClient.readContract({
       address: CONTRACTS.REGISTRY as Address,
       abi: REGISTRY_READ_ABI,
       functionName: "getAllUserBlocks",
       args: [userAddress],
     });
     return (result as Address[]).filter(addr => addr !== ZERO_ADDRESS);
   } catch {
     // Fallback: iterate through levels 1-7
     for (let level = 1; level <= 7; level++) {
       const blockAddr = await readMyBlockAtLevel(publicClient, userAddress, level);
       if (blockAddr) {
         blocks.push(blockAddr);
       }
     }
     return blocks;
   }
 }
 
 /**
  * Read complete block data from contract
  */
 export async function readBlockData(
   publicClient: any,
   blockAddress: Address
 ): Promise<OnChainBlockData | null> {
   try {
     const [owner, levelId, requiredMembers, contributionAmount, status, createdAt, completedAt, registry] =
       await Promise.all([
         publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "owner",
         }),
         publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "levelId",
         }),
         publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "requiredMembers",
         }),
         publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "contributionAmount",
         }),
         publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "status",
         }),
         publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "createdAt",
         }),
         publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "completedAt",
         }),
         publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "registry",
         }),
       ]);
 
     // Get members (try membersCount first, then getMembers)
     let membersCount = 0;
     let members: Address[] = [];
     try {
       const mc = await publicClient.readContract({
         address: blockAddress,
         abi: BLOCK_READ_ABI,
         functionName: "membersCount",
       });
       membersCount = Number(mc);
     } catch {
       try {
         const mems = await publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "getMembers",
         });
         members = mems as Address[];
         membersCount = members.length;
       } catch {
         // Silently fail
       }
     }
 
     if (members.length === 0 && membersCount > 0) {
       try {
         members = (await publicClient.readContract({
           address: blockAddress,
           abi: BLOCK_READ_ABI,
           functionName: "getMembers",
         })) as Address[];
       } catch {
         // Silently fail
       }
     }
 
     // Try to get invited count from registry
     let invitedCount = 0;
     try {
       const ic = await publicClient.readContract({
         address: CONTRACTS.REGISTRY as Address,
         abi: REGISTRY_READ_ABI,
         functionName: "getInvitedCount",
         args: [blockAddress],
       });
       invitedCount = Number(ic);
     } catch {
       // Function may not exist yet
     }
 
     return {
       address: blockAddress,
       owner: owner as Address,
       levelId: Number(levelId),
       requiredMembers: Number(requiredMembers),
       membersCount,
       members,
       contributionAmount: contributionAmount as bigint,
       status: Number(status),
       createdAt: Number(createdAt),
       completedAt: Number(completedAt),
       registry: registry as Address,
       invitedCount,
     };
   } catch (error) {
     console.warn("[contractReads] readBlockData failed:", error);
     return null;
   }
 }
 
 /**
 * Read referral code from Registry (after contract upgrade).
 * Returns the code stored on-chain. The contract stores codes as bytes32.
 * Returns the full bytes32 (without 0x) for use in resolution.
  */
 export async function readReferralCode(
   publicClient: any,
  walletAddress: Address
 ): Promise<string | null> {
   try {
     const code = await publicClient.readContract({
       address: CONTRACTS.REGISTRY as Address,
       abi: REGISTRY_READ_ABI,
       functionName: "getReferralCode",
       args: [walletAddress],
     });
     const codeHex = code as `0x${string}`;
     if (codeHex === "0x0000000000000000000000000000000000000000000000000000000000000000") {
       return null;
     }
    // Return the full bytes32 without the 0x prefix
    // This is the exact value needed for resolveReferralCode
    return codeHex.slice(2).toUpperCase();
  } catch (error) {
    console.warn("[contractReads] readReferralCode failed:", error);
     return null;
   }
 }
 
 /**
  * Resolve referral code to wallet address (after contract upgrade)
 * Accepts:
 * - A 64-char hex string (the bytes32 without 0x prefix, as returned by readReferralCode)
 * - A full bytes32 hex string (0x followed by 64 chars)
 * - A wallet address (0x followed by 40 chars) - returns it directly
  */
 export async function resolveReferralCode(
   publicClient: any,
   code: string
 ): Promise<Address | null> {
   try {
    let codeBytes: `0x${string}`;
    
   // Check if it's a wallet address (40 hex chars after 0x)
   if (/^0x[a-fA-F0-9]{40}$/i.test(code)) {
     return code.toLowerCase() as Address;
   }
   
    // Check if already a full bytes32 hex string
    if (/^0x[a-fA-F0-9]{64}$/.test(code)) {
      codeBytes = code.toLowerCase() as `0x${string}`;
   } else if (/^[a-fA-F0-9]{64}$/i.test(code)) {
     // 64-char hex without 0x prefix (as returned by readReferralCode)
     codeBytes = ("0x" + code.toLowerCase()) as `0x${string}`;
    } else {
      // Convert human-readable string to bytes32 (padded with null bytes)
      codeBytes = ("0x" + Buffer.from(code.padEnd(32, "\0")).toString("hex")) as `0x${string}`;
    }
    
     const wallet = await publicClient.readContract({
       address: CONTRACTS.REGISTRY as Address,
       abi: REGISTRY_READ_ABI,
       functionName: "resolveReferralCode",
       args: [codeBytes],
     });
     const addr = wallet as Address;
    if (addr !== ZERO_ADDRESS) {
      return addr;
    }
     return null;
  } catch (error) {
    console.warn("[contractReads] resolveReferralCode on-chain failed:", error);
    return null;
   }
 }

 /**
  * Get referrer of a wallet (after contract upgrade)
  */
 export async function readReferrer(
   publicClient: any,
   walletAddress: Address
 ): Promise<Address | null> {
   try {
     const referrer = await publicClient.readContract({
       address: CONTRACTS.REGISTRY as Address,
       abi: REGISTRY_READ_ABI,
       functionName: "getReferrer",
       args: [walletAddress],
     });
     const addr = referrer as Address;
     return addr !== ZERO_ADDRESS ? addr : null;
   } catch {
     return null;
   }
 }
 
 /**
  * Read token balance
  */
 export async function readTokenBalance(
   publicClient: any,
   userAddress: Address,
   tokenAddress: Address = USDT_TOKEN_ADDRESS
 ): Promise<{ balance: bigint; decimals: number; formatted: string }> {
   try {
     const [balance, decimals] = await Promise.all([
       publicClient.readContract({
         address: tokenAddress,
         abi: ERC20_READ_ABI,
         functionName: "balanceOf",
         args: [userAddress],
       }),
       publicClient.readContract({
         address: tokenAddress,
         abi: ERC20_READ_ABI,
         functionName: "decimals",
       }),
     ]);
     const dec = Number(decimals);
     return {
       balance: balance as bigint,
       decimals: dec,
       formatted: formatUnits(balance as bigint, dec),
     };
   } catch (error) {
     console.warn("[contractReads] readTokenBalance failed:", error);
     return { balance: 0n, decimals: 6, formatted: "0" };
   }
 }