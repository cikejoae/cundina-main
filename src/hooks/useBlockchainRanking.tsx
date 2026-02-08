// Hook for fetching ranking data from Subgraph (primary) with RPC fallback
import { useCallback, useState, useRef } from "react";
import { usePublicClient } from "wagmi";
import { type Address, parseAbiItem } from "viem";
import { CONTRACTS } from "@/config/contracts";
import { BLOCK_READ_ABI, REGISTRY_READ_ABI } from "@/lib/contractReads";
import { SUBGRAPH_CONFIG } from "@/config/subgraph";
import { updateBlockNumberCache, computeBlockNumbersLocally } from "@/lib/blockNumbering";
import { recordRateLimit, recordSuccess, isSubgraphInCooldown, getCooldownRemaining } from "@/lib/subgraphThrottle";
import { supabase } from "@/integrations/supabase/client";

// Payout Module address for AdvanceExecuted events
const PAYOUT_MODULE_ADDRESS = "0x4B4A6047A7B6246FACe6A1605741e190441eaED3" as Address;

// Sepolia chain ID
const SEPOLIA_CHAIN_ID = 11155111;

// Level configuration (matches on-chain and DB)
export const LEVEL_CONFIG: Record<number, { 
  name: string; 
  requiredMembers: number; 
  contributionAmount: number; 
  totalCundina: number 
}> = {
  1: { name: "Curioso", requiredMembers: 9, contributionAmount: 20, totalCundina: 180 },
  2: { name: "Soñador", requiredMembers: 8, contributionAmount: 50, totalCundina: 400 },
  3: { name: "Novato", requiredMembers: 7, contributionAmount: 100, totalCundina: 700 },
  4: { name: "Aprendiz", requiredMembers: 6, contributionAmount: 250, totalCundina: 1500 },
  5: { name: "Asesor", requiredMembers: 5, contributionAmount: 500, totalCundina: 2500 },
  6: { name: "Maestro", requiredMembers: 4, contributionAmount: 1000, totalCundina: 4000 },
  7: { name: "Leyenda", requiredMembers: 3, contributionAmount: 2500, totalCundina: 7500 },
};

// Block data from on-chain/subgraph
export interface OnChainRankingBlock {
  id: string; // contract address (lowercase)
  blockAddress: Address;
  owner: Address;
  levelId: number;
  status: "active" | "completed" | "claimed";
  membersCount: number;
  requiredMembers: number;
  invitedCount: number;
  createdAt: number;
  completedAt: number;
  // UI fields
  block_number: number;
  level_block_number: number;
  levels: {
    name: string;
    required_members: number;
    contribution_amount: number;
    total_cundina: number;
  };
}

// MyBlockCreated event signature
const MY_BLOCK_CREATED_EVENT = parseAbiItem(
  "event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress)"
);

// AdvanceExecuted event from PayoutModule - used to identify claimed blocks
const ADVANCE_EXECUTED_EVENT = parseAbiItem(
  "event AdvanceExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo, address nextBlock)"
);

export interface UseBlockchainRankingReturn {
  fetchRanking: (levelId: number, status: "active" | "completed" | "claimed") => Promise<OnChainRankingBlock[]>;
  isLoading: boolean;
  error: Error | null;
  dataSource: "subgraph" | "rpc" | null;
}

// Response cache to avoid redundant fetches
interface CachedResponse {
  data: OnChainRankingBlock[];
  fetchedAt: number;
}
const responseCache = new Map<string, CachedResponse>();
const RESPONSE_CACHE_TTL_MS = 60_000; // 60s (event-driven refresh invalidates cache on changes)

/**
 * Invalidate the response cache so the next fetch hits the subgraph.
 * Called by event-driven refresh when on-chain changes are detected.
 */
export function invalidateRankingCache() {
  responseCache.clear();
  console.log("[useBlockchainRanking] Response cache invalidated");
}

async function fetchClaimedBlockAddresses(publicClient: any): Promise<Set<string>> {
  const claimedSet = new Set<string>();
  if (!publicClient) return claimedSet;

  try {
    const currentBlock = await publicClient.getBlockNumber();
    const rangesToTry = [9000n, 5000n, 2000n];

    for (const range of rangesToTry) {
      const fromBlock = currentBlock > range ? currentBlock - range : 0n;
      try {
        const logs = await publicClient.getLogs({
          address: PAYOUT_MODULE_ADDRESS,
          event: ADVANCE_EXECUTED_EVENT,
          fromBlock,
          toBlock: currentBlock,
        });
        for (const log of logs) {
          if (log.args?.blockAddr) {
            claimedSet.add((log.args.blockAddr as string).toLowerCase());
          }
        }
        break;
      } catch {
        if (range === rangesToTry[rangesToTry.length - 1]) break;
      }
    }
  } catch (err) {
    console.warn("[useBlockchainRanking] Failed to fetch AdvanceExecuted events:", err);
  }

  return claimedSet;
}

// Cache for claimed block addresses
let claimedBlocksCache: { data: Set<string>; fetchedAt: number } | null = null;
const CLAIMED_CACHE_TTL_MS = 60_000; // 60 seconds

async function getClaimedBlocks(publicClient: any): Promise<Set<string>> {
  if (claimedBlocksCache && Date.now() - claimedBlocksCache.fetchedAt < CLAIMED_CACHE_TTL_MS) {
    return claimedBlocksCache.data;
  }
  const data = await fetchClaimedBlockAddresses(publicClient);
  claimedBlocksCache = { data, fetchedAt: Date.now() };
  return data;
}

// Helper: Fetch from Subgraph (standalone, no React state)
async function fetchFromSubgraph(
  levelId: number, 
  status: "active" | "completed" | "claimed",
  publicClient?: any
): Promise<OnChainRankingBlock[] | null> {
  // Check cooldown before making request
  if (isSubgraphInCooldown()) {
    const remaining = getCooldownRemaining();
    console.log(`[useBlockchainRanking] Subgraph in cooldown (${remaining}s remaining), skipping`);
    return null;
  }

    const statusValue = status === "active" ? 0 : 1;
    const needsClaimedFilter = status === "completed" || status === "claimed";
  // Fetch ALL blocks for this level (both active and completed) in ONE query.
  // This lets us compute block numbering locally without a separate subgraph call.
  const query = `
    query GetAllBlocksByLevel($levelId: Int!) {
      blocks(
        where: { levelId: $levelId }
        orderBy: createdAt
        orderDirection: asc
        first: 1000
      ) {
        id
        owner { id }
        levelId
        status
        invitedCount
        createdAt
        completedAt
        members { id }
      }
    }
  `;

  try {
    console.log(`[useBlockchainRanking] Fetching from Subgraph for level ${levelId} (all statuses, via proxy)`);
    
    let result: any;

    if (SUBGRAPH_CONFIG.USE_PROXY) {
      const { data, error } = await supabase.functions.invoke('subgraph-proxy', {
        body: { query, variables: { levelId } },
      });
      if (error) {
        if (error.message?.includes('429')) {
          recordRateLimit();
          throw new Error(`Subgraph HTTP error: 429`);
        }
        throw new Error(`Proxy error: ${error.message}`);
      }
      result = data;
    } else {
      const response = await fetch(SUBGRAPH_CONFIG.STUDIO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { levelId } }),
      });

      if (response.status === 429) {
        recordRateLimit();
        throw new Error(`Subgraph HTTP error: 429`);
      }
      if (!response.ok) {
        throw new Error(`Subgraph HTTP error: ${response.status}`);
      }
      result = await response.json();
    }
    
    if (result?.errors) {
      throw new Error(`Subgraph query error: ${result.errors[0]?.message}`);
    }

    // Success — reset cooldown
    recordSuccess();

    const allBlocks = result.data?.blocks || [];
    console.log(`[useBlockchainRanking] Subgraph returned ${allBlocks.length} total blocks for level ${levelId}`);

    // Compute block numbering locally from ALL blocks (sorted by createdAt asc)
    // This eliminates the separate blockNumbering subgraph query!
    const blockNumMap = computeBlockNumbersLocally(
      allBlocks.map((b: any) => ({ id: b.id, createdAt: Number(b.createdAt) }))
    );

    // Also update the shared cache so other pages (BlockDetail) benefit
    updateBlockNumberCache(
      levelId,
      allBlocks.map((b: any) => b.id)
    );

    const config = LEVEL_CONFIG[levelId] || LEVEL_CONFIG[1];

    // For completed/claimed, fetch all completed blocks then split by claimed status
    let claimedSet = new Set<string>();
    if (needsClaimedFilter && publicClient) {
      claimedSet = await getClaimedBlocks(publicClient);
      console.log(`[useBlockchainRanking] Found ${claimedSet.size} claimed blocks`);
    }

    // Filter by on-chain status (both completed and claimed are status=1 on-chain)
    const onChainStatus = status === "active" ? 0 : 1;
    const filteredBlocks = allBlocks
      .filter((block: any) => {
        if (block.status !== onChainStatus) return false;
        if (status === "completed") {
          // Completed = status 1 AND not claimed
          return !claimedSet.has(block.id.toLowerCase());
        }
        if (status === "claimed") {
          // Claimed = status 1 AND in claimed set
          return claimedSet.has(block.id.toLowerCase());
        }
        return true; // active
      })
      .sort((a: any, b: any) => (b.invitedCount || 0) - (a.invitedCount || 0));

    console.log(`[useBlockchainRanking] Filtered to ${filteredBlocks.length} ${status} blocks`);

    return filteredBlocks.map((block: any) => {
      const stableNum = blockNumMap.get(block.id.toLowerCase()) ?? 0;
      const isClaimed = claimedSet.has(block.id.toLowerCase());
      return {
        id: block.id,
        blockAddress: block.id as Address,
        owner: block.owner.id as Address,
        levelId: block.levelId,
        status: block.status === 0 ? "active" : (isClaimed ? "claimed" : "completed"),
        membersCount: block.members?.length || 0,
        requiredMembers: config.requiredMembers,
        invitedCount: block.invitedCount || 0,
        createdAt: Number(block.createdAt),
        completedAt: Number(block.completedAt) || 0,
        block_number: stableNum,
        level_block_number: stableNum,
        levels: {
          name: config.name,
          required_members: config.requiredMembers,
          contribution_amount: config.contributionAmount,
          total_cundina: config.totalCundina,
        },
      };
    });
  } catch (err) {
    console.warn("[useBlockchainRanking] Subgraph fetch failed:", err);
    return null;
  }
}

// Helper: Fetch from RPC (standalone, no React state)
async function fetchFromRPC(
  publicClient: any,
  levelId: number, 
  status: "active" | "completed" | "claimed"
): Promise<OnChainRankingBlock[]> {
  if (!publicClient) {
    console.warn("[useBlockchainRanking] No public client available for RPC fallback");
    return [];
  }

  console.log(`[useBlockchainRanking] Using RPC fallback for level ${levelId}`);

  const currentBlock = await publicClient.getBlockNumber();

  // Try progressively smaller block ranges if RPC rejects the range
  const rangesToTry = [9000n, 5000n, 2000n, 1000n];
  let logs: any[] = [];

  for (const range of rangesToTry) {
    const fromBlock = currentBlock > range ? currentBlock - range : 0n;
    console.log(`[useBlockchainRanking] RPC query range ${range}: blocks ${fromBlock} to ${currentBlock}`);
    try {
      logs = await publicClient.getLogs({
        address: CONTRACTS.REGISTRY as Address,
        event: MY_BLOCK_CREATED_EVENT,
        args: { level: BigInt(levelId) },
        fromBlock,
        toBlock: currentBlock,
      });
      break; // Success, stop trying
    } catch (rangeErr) {
      console.warn(`[useBlockchainRanking] RPC range ${range} failed:`, rangeErr);
      if (range === rangesToTry[rangesToTry.length - 1]) {
        throw rangeErr; // Last attempt failed, propagate error
      }
    }
  }

  console.log(`[useBlockchainRanking] RPC found ${logs.length} blocks for level ${levelId}`);

  if (logs.length === 0) return [];

  const blockAddresses = logs.map((log: any) => log.args.blockAddress as Address);
  const blocks: OnChainRankingBlock[] = [];
  const batchSize = 10;

  for (let i = 0; i < blockAddresses.length; i += batchSize) {
    const batch = blockAddresses.slice(i, i + batchSize);
    const batchPromises = batch.map(async (blockAddr: Address, batchIndex: number) => {
      try {
        const [owner, blockLevel, requiredMembers, membersCount, blockStatus, createdAt, completedAt] =
          await Promise.all([
            publicClient.readContract({ address: blockAddr, abi: BLOCK_READ_ABI, functionName: "owner" }),
            publicClient.readContract({ address: blockAddr, abi: BLOCK_READ_ABI, functionName: "levelId" }),
            publicClient.readContract({ address: blockAddr, abi: BLOCK_READ_ABI, functionName: "requiredMembers" }),
            publicClient.readContract({ address: blockAddr, abi: BLOCK_READ_ABI, functionName: "membersCount" }),
            publicClient.readContract({ address: blockAddr, abi: BLOCK_READ_ABI, functionName: "status" }),
            publicClient.readContract({ address: blockAddr, abi: BLOCK_READ_ABI, functionName: "createdAt" }),
            publicClient.readContract({ address: blockAddr, abi: BLOCK_READ_ABI, functionName: "completedAt" }),
          ]);

        let invitedCount = 0;
        try {
          const ic = await publicClient.readContract({
            address: CONTRACTS.REGISTRY as Address,
            abi: REGISTRY_READ_ABI,
            functionName: "getInvitedCount",
            args: [blockAddr],
          });
          invitedCount = Number(ic);
        } catch {}

        const statusValue = Number(blockStatus);
        const onChainStatus = statusValue === 0 ? "active" : "completed";

        // For active, only include active blocks
        if (status === "active" && onChainStatus !== "active") return null;
        // For completed/claimed, only include completed blocks (filtering happens after)
        if ((status === "completed" || status === "claimed") && onChainStatus !== "completed") return null;

        const level = Number(blockLevel);
        const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[1];

        return {
          id: blockAddr.toLowerCase(),
          blockAddress: blockAddr,
          owner: owner as Address,
          levelId: level,
          status: onChainStatus,
          membersCount: Number(membersCount),
          requiredMembers: Number(requiredMembers),
          invitedCount,
          createdAt: Number(createdAt),
          completedAt: Number(completedAt),
          block_number: 0, // Will be set below via getBlockNumbers
          level_block_number: 0,
          levels: {
            name: config.name,
            required_members: config.requiredMembers,
            contribution_amount: config.contributionAmount,
            total_cundina: config.totalCundina,
          },
        } as OnChainRankingBlock;
      } catch (err) {
        console.warn(`[useBlockchainRanking] Failed to read block ${blockAddr}:`, err);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    blocks.push(...batchResults.filter((b): b is OnChainRankingBlock => b !== null));
  }

  // Assign block numbers from event log order (chronological).
  // RPC fallback should NOT make additional subgraph calls — the subgraph
  // is already in cooldown which is why we're here.
  // blockAddresses is in emission order from getLogs, so use that directly.
  const logOrderMap = new Map<string, number>();
  blockAddresses.forEach((addr: Address, idx: number) => {
    logOrderMap.set(addr.toLowerCase(), idx + 1);
  });
  blocks.forEach(block => {
    const num = logOrderMap.get(block.id.toLowerCase()) ?? 0;
    block.block_number = num;
    block.level_block_number = num;
  });
  console.log(`[useBlockchainRanking] RPC numbering from log order (${blocks.length} blocks)`);

  // For completed/claimed, filter by claimed status
  if (status === "completed" || status === "claimed") {
    const claimedSet = await getClaimedBlocks(publicClient);
    const filtered = blocks.filter(block => {
      const isClaimed = claimedSet.has(block.id.toLowerCase());
      if (status === "claimed") return isClaimed;
      return !isClaimed; // completed = not claimed
    });
    // Update status field
    filtered.forEach(b => {
      b.status = status === "claimed" ? "claimed" : "completed";
    });
    filtered.sort((a, b) => {
      if (b.invitedCount !== a.invitedCount) return b.invitedCount - a.invitedCount;
      if (b.membersCount !== a.membersCount) return b.membersCount - a.membersCount;
      return a.createdAt - b.createdAt;
    });
    return filtered;
  }

  // Sort by invitedCount desc, membersCount desc, createdAt asc
  blocks.sort((a, b) => {
    if (b.invitedCount !== a.invitedCount) return b.invitedCount - a.invitedCount;
    if (b.membersCount !== a.membersCount) return b.membersCount - a.membersCount;
    return a.createdAt - b.createdAt;
  });

  return blocks;
}

/**
 * Hook for fetching ranking data.
 * 
 * Uses Subgraph as primary source (unlimited history, faster queries).
 * Falls back to RPC if Subgraph is unavailable.
 */
export const useBlockchainRanking = (): UseBlockchainRankingReturn => {
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const dataSourceRef = useRef<"subgraph" | "rpc" | null>(null);

  const fetchRanking = useCallback(
    async (levelId: number, status: "active" | "completed" | "claimed"): Promise<OnChainRankingBlock[]> => {
      // Check response cache first (avoid redundant requests within 30s)
      const cacheKey = `${levelId}-${status}`;
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < RESPONSE_CACHE_TTL_MS) {
        console.log(`[useBlockchainRanking] Using cached data for level ${levelId} (${cached.data.length} blocks)`);
        return cached.data;
      }

      setIsLoading(true);
      setError(null);

      try {
        console.log(`[useBlockchainRanking] Fetching blocks for level ${levelId}, status ${status}`);

        // Use Subgraph as primary source (indexed, fast, real-time)
        const subgraphResult = await fetchFromSubgraph(levelId, status, publicClient);
        
        if (subgraphResult !== null && subgraphResult.length > 0) {
          dataSourceRef.current = "subgraph";
          console.log(`[useBlockchainRanking] Using Subgraph data: ${subgraphResult.length} blocks`);
          responseCache.set(cacheKey, { data: subgraphResult, fetchedAt: Date.now() });
          return subgraphResult;
        }

        // Fallback to RPC if Subgraph returns empty or fails
        // Only use RPC if subgraph is in cooldown or returned empty (not just no results)
        if (isSubgraphInCooldown()) {
          console.log(`[useBlockchainRanking] Subgraph in cooldown, trying RPC fallback...`);
          const rpcResult = await fetchFromRPC(publicClient, levelId, status);
          
          if (rpcResult.length > 0) {
            dataSourceRef.current = "rpc";
            console.log(`[useBlockchainRanking] Using RPC fallback: ${rpcResult.length} blocks`);
            responseCache.set(cacheKey, { data: rpcResult, fetchedAt: Date.now() });
            return rpcResult;
          }
        }

        // If we have stale cache, return it rather than nothing
        if (cached) {
          console.log(`[useBlockchainRanking] Using stale cache as fallback (${cached.data.length} blocks)`);
          return cached.data;
        }

        console.log(`[useBlockchainRanking] No blocks found from either source`);
        return [];

      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to fetch ranking");
        setError(error);
        console.error("[useBlockchainRanking] Error:", error);
        // Return stale cache on error
        if (cached) return cached.data;
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [publicClient]
  );

  return {
    fetchRanking,
    isLoading,
    error,
    dataSource: dataSourceRef.current,
  };
};