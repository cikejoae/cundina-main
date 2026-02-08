import { useState, useCallback, useEffect, useRef } from 'react';

interface StoredPositionData {
  position: number;
  lastTrend: 'up' | 'down' | 'same' | 'new';
}

// LocalStorage cache key
const cacheKeyForLevel = (levelId: string) => `ranking_positions_v3:${levelId}`;

const safeParseTrend = (value: unknown): StoredPositionData['lastTrend'] => {
  return value === 'up' || value === 'down' || value === 'same' || value === 'new' ? value : 'same';
};

const loadFromStorage = (levelId: string): Record<string, StoredPositionData> => {
  try {
    const raw = localStorage.getItem(cacheKeyForLevel(levelId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { position?: unknown; lastTrend?: unknown }>;
    if (!parsed || typeof parsed !== 'object') return {};

    const out: Record<string, StoredPositionData> = {};
    for (const [blockId, v] of Object.entries(parsed)) {
      const pos = typeof v?.position === 'number' ? v.position : undefined;
      if (!pos) continue;
      out[blockId] = {
        position: pos,
        lastTrend: safeParseTrend(v?.lastTrend),
      };
    }
    return out;
  } catch {
    return {};
  }
};

const saveToStorage = (levelId: string, data: Record<string, StoredPositionData>) => {
  try {
    localStorage.setItem(cacheKeyForLevel(levelId), JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
};

/**
 * Hook for ranking position tracking using localStorage.
 * 
 * Note: Subgraph-based trends (rankingSnapshots) are disabled because the entity
 * does not exist in the current subgraph v0.0.4. This eliminates an unnecessary
 * subgraph call that always fails. When the subgraph is upgraded to include
 * rankingSnapshots, re-enable useSubgraphRankingTrends here.
 */
export function useRankingPositions(levelId: string) {
  // LocalStorage-based state
  const [localPositions, setLocalPositions] = useState<Record<string, StoredPositionData>>({});
  const [loading, setLoading] = useState(false);
  const initialLoadDone = useRef(false);
  const lastSavedPositionsRef = useRef<Record<string, StoredPositionData>>({});
  const hasSavedThisSession = useRef(false);
  const pendingBlocksRef = useRef<{ id: string; contract_address?: string | null }[] | null>(null);

  // Load previous positions from localStorage
  const loadPreviousPositions = useCallback(async () => {
    if (initialLoadDone.current) return;
    
    setLoading(true);
    try {
      const cached = loadFromStorage(levelId);
      setLocalPositions(cached);
      lastSavedPositionsRef.current = cached;
      initialLoadDone.current = true;
      hasSavedThisSession.current = false;
    } finally {
      setLoading(false);
    }
  }, [levelId]);

  // Save current positions to localStorage
  const saveCurrentPositions = useCallback((
    blocks: { id: string; contract_address?: string | null }[]
  ) => {
    if (!blocks || blocks.length === 0) return;

    // Wait for initial load to complete
    if (!initialLoadDone.current) {
      pendingBlocksRef.current = blocks;
      return;
    }

    // Calculate trends for each block
    const newPositions: Record<string, StoredPositionData> = {};
    let hasChanges = false;

    for (let idx = 0; idx < blocks.length; idx++) {
      const block = blocks[idx];
      const blockKey = block.contract_address?.toLowerCase() || block.id;
      const currentPosition = idx + 1;
      const previousData = lastSavedPositionsRef.current[blockKey];

      let trend: 'up' | 'down' | 'same' | 'new';

      if (!previousData) {
        trend = 'new';
        hasChanges = true;
      } else if (currentPosition < previousData.position) {
        trend = 'up';
        hasChanges = true;
      } else if (currentPosition > previousData.position) {
        trend = 'down';
        hasChanges = true;
      } else {
        trend = previousData.lastTrend;
      }

      newPositions[blockKey] = {
        position: currentPosition,
        lastTrend: trend
      };
    }

    // Skip save if no changes and we've already saved this session
    if (!hasChanges && hasSavedThisSession.current) {
      return;
    }

    // Save to localStorage
    saveToStorage(levelId, newPositions);
    lastSavedPositionsRef.current = newPositions;
    hasSavedThisSession.current = true;
  }, [levelId]);

  // Flush any queued save after initial load
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (!pendingBlocksRef.current) return;
    const queued = pendingBlocksRef.current;
    pendingBlocksRef.current = null;
    saveCurrentPositions(queued);
  }, [localPositions, saveCurrentPositions]);

  /**
   * Get trend indicator for a block position (localStorage only).
   */
  const getPositionTrend = useCallback((
    blockId: string,
    currentPosition: number
  ): { trend: 'up' | 'down' | 'same' | 'new'; diff: number } => {
    const blockKey = blockId.toLowerCase();
    const previousData = localPositions[blockKey] || localPositions[blockId];

    if (!previousData) {
      return { trend: 'new', diff: 0 };
    }

    const previousPosition = previousData.position;
    const diff = Math.abs(currentPosition - previousPosition);

    if (currentPosition < previousPosition) {
      return { trend: 'up', diff };
    }
    if (currentPosition > previousPosition) {
      return { trend: 'down', diff };
    }

    return { trend: previousData.lastTrend, diff: 0 };
  }, [localPositions]);

  // Reset when level changes
  useEffect(() => {
    initialLoadDone.current = false;
    lastSavedPositionsRef.current = {};
    hasSavedThisSession.current = false;
    pendingBlocksRef.current = null;
    setLocalPositions({});
    loadPreviousPositions();
  }, [levelId, loadPreviousPositions]);

  return {
    previousPositions: localPositions,
    loading,
    loadPreviousPositions,
    saveCurrentPositions,
    getPositionTrend,
  };
}
