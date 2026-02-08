import { useState, useCallback, useEffect, useRef } from 'react';
import { SUBGRAPH_CONFIG } from '@/config/subgraph';
import { isSubgraphInCooldown, recordRateLimit, recordSuccess } from '@/lib/subgraphThrottle';
import { supabase } from '@/integrations/supabase/client';

interface RankingSnapshot {
  block: {
    id: string;
  };
  invitedCount: number;
  day: string;
}

interface TrendData {
  trend: 'up' | 'down' | 'same' | 'new';
  diff: number;
}

const SECONDS_PER_DAY = 86400;

// Get yesterday's unix day
function getYesterdayDay(): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.floor(now / SECONDS_PER_DAY) - 1;
}

/**
 * Hook to fetch ranking trends from the Subgraph.
 * Compares current positions with positions from yesterday.
 * Respects subgraph cooldown to avoid 429 storms.
 */
export function useSubgraphRankingTrends(levelId: number) {
  const [previousPositions, setPreviousPositions] = useState<Map<string, number>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasHistoricalData, setHasHistoricalData] = useState(false);
  const fetchedLevelRef = useRef<number | null>(null);

  // Fetch historical snapshots from subgraph
  const fetchHistoricalPositions = useCallback(async () => {
    // Skip if already fetched for this level
    if (fetchedLevelRef.current === levelId) return;

    // Respect cooldown — don't add more 429s
    if (isSubgraphInCooldown()) {
      console.log('[SubgraphTrends] Subgraph in cooldown, skipping trends fetch');
      setHasHistoricalData(false);
      return;
    }
    
    setLoading(true);
    setError(null);

    try {
      const yesterdayDay = getYesterdayDay();
      
      // Query snapshots from yesterday for this level
      const query = `
        query GetYesterdaySnapshots($levelId: Int!, $day: BigInt!) {
          rankingSnapshots(
            where: { levelId: $levelId, day: $day }
            orderBy: invitedCount
            orderDirection: desc
          ) {
            block {
              id
            }
            invitedCount
            day
          }
        }
      `;

      let result: any;

      if (SUBGRAPH_CONFIG.USE_PROXY) {
        const { data, error } = await supabase.functions.invoke('subgraph-proxy', {
          body: {
            query,
            variables: { levelId, day: yesterdayDay.toString() }
          },
        });
        if (error) {
          if (error.message?.includes('429')) {
            recordRateLimit();
            throw new Error('Subgraph request failed: 429');
          }
          throw new Error(`Proxy error: ${error.message}`);
        }
        result = data;
      } else {
        const response = await fetch(SUBGRAPH_CONFIG.STUDIO_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { levelId, day: yesterdayDay.toString() }
          })
        });

        if (response.status === 429) {
          recordRateLimit();
          throw new Error('Subgraph request failed: 429');
        }
        if (!response.ok) {
          throw new Error(`Subgraph request failed: ${response.status}`);
        }
        // Success
        recordSuccess();
        result = await response.json();
      }

      // If the entity doesn't exist in this subgraph version, silently fall back
      if (result?.errors) {
        const msg = result.errors[0]?.message || '';
        if (msg.includes('has no field')) {
          // Entity not deployed in current subgraph version — use localStorage fallback
          fetchedLevelRef.current = levelId;
          setHasHistoricalData(false);
          return;
        }
        throw new Error(msg || 'GraphQL error');
      }

      // Success for proxy path
      if (SUBGRAPH_CONFIG.USE_PROXY) {
        recordSuccess();
      }

      const snapshots: RankingSnapshot[] = result.data?.rankingSnapshots || [];
      
      // Build position map (position is index + 1)
      const positionMap = new Map<string, number>();
      snapshots.forEach((snapshot, index) => {
        const blockId = snapshot.block.id.toLowerCase();
        positionMap.set(blockId, index + 1);
      });

      setPreviousPositions(positionMap);
      setHasHistoricalData(positionMap.size > 0);
      fetchedLevelRef.current = levelId;
      console.log(`[SubgraphTrends] Loaded ${positionMap.size} historical positions for level ${levelId}`);
    } catch (err) {
      console.warn('[SubgraphTrends] Error fetching trends:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setHasHistoricalData(false);
    } finally {
      setLoading(false);
    }
  }, [levelId]);

  // Get trend for a specific block
  const getPositionTrend = useCallback((
    blockId: string,
    currentPosition: number
  ): TrendData => {
    const normalizedId = blockId.toLowerCase();
    const previousPosition = previousPositions.get(normalizedId);

    if (previousPosition === undefined) {
      // Block wasn't in yesterday's ranking - it's new
      return { trend: 'new', diff: 0 };
    }

    const diff = Math.abs(currentPosition - previousPosition);

    if (currentPosition < previousPosition) {
      return { trend: 'up', diff };
    }
    if (currentPosition > previousPosition) {
      return { trend: 'down', diff };
    }

    return { trend: 'same', diff: 0 };
  }, [previousPositions]);

  // Fetch on mount and when level changes
  useEffect(() => {
    fetchedLevelRef.current = null;
    setPreviousPositions(new Map());
    setHasHistoricalData(false);
    fetchHistoricalPositions();
  }, [levelId, fetchHistoricalPositions]);

  const refetch = useCallback(() => {
    fetchedLevelRef.current = null;
    fetchHistoricalPositions();
  }, [fetchHistoricalPositions]);

  return {
    loading,
    error,
    getPositionTrend,
    hasHistoricalData,
    refetch
  };
}
