// Shared utility for consistent block numbering across the app.
// Block numbers are consecutive within each level (1, 2, 3, ...)
// based on on-chain creation order (createdAt from the Subgraph).
// Once assigned, a block's number NEVER changes.

import { querySubgraph } from "@/lib/subgraph";

// Query to get all blocks at a given level, sorted by creation time
const BLOCKS_AT_LEVEL_QUERY = `
  query GetBlocksAtLevel($levelId: Int!, $first: Int!) {
    blocks(
      where: { levelId: $levelId }
      orderBy: createdAt
      orderDirection: asc
      first: $first
    ) {
      id
    }
  }
`;

interface BlocksAtLevelResult {
  blocks: { id: string }[];
}

// Cache entry with TTL
interface CacheEntry {
  blocks: string[];
  fetchedAt: number;
}

// In-memory cache: levelId -> ordered list of block addresses + timestamp
const levelBlockOrderCache = new Map<number, CacheEntry>();

// Cache TTL: 5 minutes (avoid redundant subgraph calls)
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Check if cache entry is still valid (within TTL)
 */
function isCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

/**
 * Get the consecutive block number for a given block address within its level.
 * The number is determined by the block's position in the creation order
 * (earliest block = #1, next = #2, etc.).
 *
 * @returns The 1-based consecutive number, or null if the block is not found.
 */
export async function getBlockNumber(
  blockAddress: string,
  levelId: number
): Promise<number | null> {
  const normalizedAddress = blockAddress.toLowerCase();

  // Check cache first (use if valid TTL)
  const cached = levelBlockOrderCache.get(levelId);

  if (isCacheValid(cached)) {
    const idx = cached.blocks.indexOf(normalizedAddress);
    if (idx >= 0) return idx + 1;
    // Block not in cache but cache is still fresh — don't re-fetch yet
    // (it might be a very new block not yet indexed)
    return null;
  }

  // Fetch from Subgraph (fresh data)
  try {
    const result = await querySubgraph<BlocksAtLevelResult>(
      BLOCKS_AT_LEVEL_QUERY,
      { levelId, first: 1000 }
    );

    const blocks = result.blocks.map((b) => b.id.toLowerCase());
    levelBlockOrderCache.set(levelId, { blocks, fetchedAt: Date.now() });

    const idx = blocks.indexOf(normalizedAddress);
    return idx >= 0 ? idx + 1 : null;
  } catch (err) {
    console.warn("[blockNumbering] Subgraph query failed:", err);
    // If we have stale cache, use it as fallback
    const staleCache = levelBlockOrderCache.get(levelId);
    if (staleCache) {
      const idx = staleCache.blocks.indexOf(normalizedAddress);
      return idx >= 0 ? idx + 1 : null;
    }
    return null;
  }
}

/**
 * Get block numbers for multiple blocks at once (batch).
 * More efficient than calling getBlockNumber individually.
 * Uses TTL cache to avoid redundant subgraph requests.
 *
 * @returns A Map from block address (lowercase) to its consecutive number.
 */
export async function getBlockNumbers(
  blocks: { address: string; levelId: number }[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (blocks.length === 0) return result;

  // Group by level
  const byLevel = new Map<number, string[]>();
  for (const b of blocks) {
    const addr = b.address.toLowerCase();
    if (!byLevel.has(b.levelId)) byLevel.set(b.levelId, []);
    byLevel.get(b.levelId)!.push(addr);
  }

  // Fetch each level's ordering (respecting TTL cache)
  const fetchPromises = Array.from(byLevel.entries()).map(
    async ([levelId, addresses]) => {
      const cached = levelBlockOrderCache.get(levelId);

      // If cache is valid, use it directly (no subgraph call!)
      if (isCacheValid(cached)) {
        for (const addr of addresses) {
          const idx = cached.blocks.indexOf(addr);
          if (idx >= 0) {
            result.set(addr, idx + 1);
          }
        }
        return;
      }

      // Cache expired or missing — fetch from subgraph
      try {
        const sgResult = await querySubgraph<BlocksAtLevelResult>(
          BLOCKS_AT_LEVEL_QUERY,
          { levelId, first: 1000 }
        );
        const orderedBlocks = sgResult.blocks.map((b) => b.id.toLowerCase());
        levelBlockOrderCache.set(levelId, { blocks: orderedBlocks, fetchedAt: Date.now() });

        for (const addr of addresses) {
          const idx = orderedBlocks.indexOf(addr);
          if (idx >= 0) {
            result.set(addr, idx + 1);
          }
        }
      } catch (err) {
        console.warn(
          `[blockNumbering] Failed to fetch level ${levelId}:`,
          err
        );
        // Use stale cache as fallback
        const staleCache = levelBlockOrderCache.get(levelId);
        if (staleCache) {
          for (const addr of addresses) {
            const idx = staleCache.blocks.indexOf(addr);
            if (idx >= 0) {
              result.set(addr, idx + 1);
            }
          }
        }
      }
    }
  );

  await Promise.all(fetchPromises);
  return result;
}

/**
 * Clear the cache (useful after creating a new block).
 */
export function clearBlockNumberCache(levelId?: number) {
  if (levelId !== undefined) {
    levelBlockOrderCache.delete(levelId);
  } else {
    levelBlockOrderCache.clear();
  }
}

/**
 * Populate the cache directly from externally-fetched block data.
 * This avoids a separate Subgraph query when the caller already has
 * the full list of blocks sorted by createdAt.
 *
 * @param levelId - The level to cache
 * @param blockAddresses - Block addresses in creation order (earliest first)
 */
export function updateBlockNumberCache(levelId: number, blockAddresses: string[]) {
  const normalized = blockAddresses.map(a => a.toLowerCase());
  levelBlockOrderCache.set(levelId, { blocks: normalized, fetchedAt: Date.now() });
}

/**
 * Compute block numbers from a list of blocks sorted by createdAt (ascending).
 * Returns a Map from address (lowercase) to 1-based consecutive number.
 * Does NOT make any Subgraph calls.
 */
export function computeBlockNumbersLocally(
  allBlocksAtLevel: { id: string; createdAt: number }[]
): Map<string, number> {
  // Sort by createdAt ascending to get stable numbering
  const sorted = [...allBlocksAtLevel].sort((a, b) => a.createdAt - b.createdAt);
  const result = new Map<string, number>();
  sorted.forEach((block, idx) => {
    result.set(block.id.toLowerCase(), idx + 1);
  });
  return result;
}
