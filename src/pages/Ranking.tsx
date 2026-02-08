import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Star, RefreshCw, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRankingPositions } from "@/hooks/useRankingPositions";
import { useBlockchainRanking, LEVEL_CONFIG, type OnChainRankingBlock } from "@/hooks/useBlockchainRanking";
import { useOnChainData } from "@/hooks/useOnChainData";
import { useAppKitAccount } from "@reown/appkit/react";
import { type Address } from "viem";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useContractEventRefresh } from "@/hooks/useContractEventRefresh";
import { invalidateRankingCache } from "@/hooks/useBlockchainRanking";
import RankingBlockCard, { type Block, type StatusFilter } from "@/components/ranking/RankingBlockCard";

const statusConfig: Record<StatusFilter, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active: { label: 'Activos', variant: 'default' },
  completed: { label: 'Completados', variant: 'secondary' },
  claimed: { label: 'Reclamados', variant: 'outline' },
  cancelled: { label: 'Cancelados', variant: 'destructive' },
};

interface Level {
  id: number;
  name: string;
  required_members: number;
}

// Adapter: Convert blockchain block to UI block format
const blockchainBlockToUI = (block: OnChainRankingBlock): Block & { contract_address: string } => ({
  id: block.id,
  block_number: block.block_number,
  level_block_number: block.level_block_number,
  level_id: block.levelId,
  creator_id: block.owner,
  current_members: block.membersCount,
  invited_members_count: block.invitedCount,
  assigned_members_count: 0,
  status: block.status,
  created_at: new Date(block.createdAt * 1000).toISOString(),
  creator_wallet_address: block.owner,
  levels: block.levels,
  contract_address: block.id,
});

// Generate levels from config
const LEVELS_FROM_CONFIG: Level[] = Object.entries(LEVEL_CONFIG).map(([id, config]) => ({
  id: Number(id),
  name: config.name,
  required_members: config.requiredMembers,
}));

const truncateAddress = (addr: string | null) => {
  if (!addr) return '—';
  return `${addr.slice(0, 4)}...${addr.slice(-3)}`;
};
// Component
const Ranking = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { address: account } = useAppKitAccount();
  const { fetchRanking, isLoading: blockchainLoading } = useBlockchainRanking();
  const { getUserBlocks, isReady: onChainReady } = useOnChainData();

  const [selectedLevel, setSelectedLevel] = useState("1");
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('active');
  const [levels] = useState<Level[]>(LEVELS_FROM_CONFIG);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [userWalletAddresses, setUserWalletAddresses] = useState<Set<string>>(new Set());
  const [userBlockAddresses, setUserBlockAddresses] = useState<Set<string>>(new Set());
  
  const { 
    previousPositions, 
    saveCurrentPositions, 
    getPositionTrend 
  } = useRankingPositions(selectedLevel);

  const PAGE_SIZE = 10;
  const { visibleCount, sentinelRef, hasMore } = useInfiniteScroll({
    totalItems: blocks.length,
    pageSize: PAGE_SIZE,
  });
  const visibleBlocks = blocks.slice(0, visibleCount);

  useEffect(() => {
    if (account) {
      setUserWalletAddresses(new Set([account.toLowerCase()]));
    }
  }, [account]);

  useEffect(() => {
    if (account && onChainReady) {
      fetchUserBlocksFromChain();
    }
  }, [account, onChainReady]);

  useEffect(() => {
    fetchBlocksFromBlockchain();
  }, [selectedLevel, selectedStatus]);

  const fetchUserBlocksFromChain = async () => {
    if (!account) return;
    try {
      const userBlocks = await getUserBlocks(account as Address);
      const blockAddrs = new Set(userBlocks.map(b => b.address.toLowerCase()));
      setUserBlockAddresses(blockAddrs);
    } catch (err) {
      console.warn('[Ranking] Failed to fetch user blocks:', err);
    }
  };

  const fetchBlocksFromBlockchain = async (silent = false) => {
    if (!silent) setLoading(true);
    
    const levelId = parseInt(selectedLevel);
    
    if (selectedStatus === 'cancelled') {
      setBlocks([]);
      if (!silent) setLoading(false);
      return;
    }
    
    try {
      const fetchStatus = selectedStatus as "active" | "completed" | "claimed";
      const blockchainBlocks = await fetchRanking(levelId, fetchStatus);
      const uiBlocks = blockchainBlocks.map(blockchainBlockToUI);
      setBlocks(uiBlocks);
      saveCurrentPositions(uiBlocks);
    } catch (err) {
      console.error('[Ranking] Failed to fetch from blockchain:', err);
      if (!silent) setBlocks([]);
    }
    
    if (!silent) setLoading(false);
  };

  const isUserBlock = (block: Block): { isOwner: boolean; isMember: boolean } => {
    const blockAddrLower = block.id.toLowerCase();
    const creatorLower = block.creator_wallet_address?.toLowerCase() || '';
    const isOwner = userWalletAddresses.has(creatorLower);
    const isMember = userBlockAddresses.has(blockAddrLower) && !isOwner;
    return { isOwner, isMember };
  };

  const getUserBlocksWithPositions = () => {
    const userBlocks: { block: Block; position: number; isOwner: boolean; isMember: boolean }[] = [];
    blocks.forEach((block, idx) => {
      const { isOwner, isMember } = isUserBlock(block);
      if (isOwner || isMember) {
        userBlocks.push({ block, position: idx + 1, isOwner, isMember });
      }
    });
    return userBlocks;
  };

  const userBlocksWithPositions = getUserBlocksWithPositions();

  const silentRefresh = useCallback(async () => {
    try {
      await fetchBlocksFromBlockchain(true);
      if (account && onChainReady) {
        fetchUserBlocksFromChain();
      }
    } catch {
      // Signal error to useAutoRefresh so it backs off
      return false;
    }
  }, [selectedLevel, selectedStatus, account, onChainReady]);

  const refreshData = useCallback(() => {
    fetchBlocksFromBlockchain();
    if (account && onChainReady) {
      fetchUserBlocksFromChain();
    }
  }, [selectedLevel, selectedStatus, account, onChainReady]);

  // Event-driven: on-chain events trigger immediate refresh (after subgraph indexing delay)
  const eventDrivenRefresh = useCallback(() => {
    invalidateRankingCache();
    silentRefresh();
  }, [silentRefresh]);

  useContractEventRefresh({
    onEvent: eventDrivenRefresh,
    enabled: true,
  });

  // Polling as safety net (longer interval since events handle real-time)
  useAutoRefresh(silentRefresh, 90_000); // 90s safety-net poll

  return (
    <div className="min-h-screen pb-24 bg-background">
      <Navigation />
      
      <div className="container mx-auto px-4 sm:px-6 pt-20">
        {/* Header with refresh */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-muted-foreground">Ranking de bloques por nivel</p>
          <Button variant="ghost" size="sm" onClick={refreshData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Tabs for Levels */}
        <Tabs value={selectedLevel} onValueChange={setSelectedLevel} className="w-full">
          <TabsList className="w-full grid grid-cols-7 mb-3 h-auto p-1.5 px-3 gap-0">
            {levels.map((level) => (
              <TabsTrigger 
                key={level.id} 
                value={level.id.toString()}
                className={`text-[10px] sm:text-xs px-1 py-1.5 rounded-md transition-all whitespace-nowrap ${
                  selectedLevel === level.id.toString()
                    ? 'bg-yellow-500 text-black font-semibold shadow-sm data-[state=active]:bg-yellow-500 data-[state=active]:text-black'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {level.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Legend for user's blocks */}
          {user && userBlocksWithPositions.length > 0 && (
            <Card className="p-3 mb-3 bg-primary/10 border-primary/30">
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-4 h-4 text-primary fill-primary" />
                <span className="text-sm font-semibold">Tus bloques en este ranking</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px] text-xs">
                      <p>La posición indica tu lugar en la cola de asignación. Menor número = recibes nuevos miembros primero.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex flex-wrap gap-2">
                {userBlocksWithPositions.map(({ block, position }) => (
                  <Badge 
                    key={block.id} 
                    variant="outline" 
                    className="bg-primary/20 border-primary/50 text-xs cursor-pointer hover:bg-primary/30"
                    onClick={() => navigate(`/block/${block.id}`)}
                  >
                    Bloque #{block.level_block_number} - Posición {position} ({truncateAddress(block.creator_wallet_address)})
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          {/* Status Filters */}
          <div className="flex gap-1.5 mb-3">
            {(Object.keys(statusConfig) as StatusFilter[]).map((status) => (
              <Button
                key={status}
                variant={selectedStatus === status ? "default" : "ghost"}
                onClick={() => setSelectedStatus(status)}
                size="sm"
                className={`text-xs h-7 px-2.5 ${
                  selectedStatus === status ? '' : 'text-muted-foreground'
                }`}
              >
                {statusConfig[status].label}
              </Button>
            ))}
          </div>

          {/* Blocks Grid */}
          {levels.map((level) => (
            <TabsContent key={level.id} value={level.id.toString()} className="mt-0">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : blocks.length === 0 ? (
                <Card className="p-6 text-center bg-muted/30">
                  <p className="text-sm text-muted-foreground">
                    No hay bloques {statusConfig[selectedStatus].label.toLowerCase()}
                  </p>
                </Card>
              ) : (
                <>
                  {/* Counter: showing X of Y */}
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">
                      Top {Math.min(visibleCount, blocks.length)} de {blocks.length} bloques
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                    {visibleBlocks.map((block, idx) => {
                      const { isOwner, isMember } = isUserBlock(block);
                      const currentPosition = idx + 1;
                      const { trend, diff } = getPositionTrend(block.id, currentPosition);
                      
                      return (
                        <RankingBlockCard
                          key={block.id}
                          block={block}
                          position={currentPosition}
                          isOwner={isOwner}
                          isMember={isMember}
                          trend={trend}
                          diff={diff}
                          selectedLevel={selectedLevel}
                        />
                      );
                    })}
                  </div>

                  {/* Infinite scroll sentinel */}
                  {hasMore && (
                    <div ref={sentinelRef} className="flex justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  {!hasMore && blocks.length > PAGE_SIZE && (
                    <p className="text-center text-xs text-muted-foreground py-4">
                      — Fin del ranking —
                    </p>
                  )}
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
};

export default Ranking;
