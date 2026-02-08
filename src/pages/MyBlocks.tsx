import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LevelBadge } from "@/components/LevelBadge";
import { Loader2, Plus, Wallet, Lock, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOnChainData, type OnChainBlockData } from "@/hooks/useOnChainData";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { parseAbi, formatUnits, type Address } from "viem";
import { CONTRACTS, USDT_TOKEN_ADDRESS } from "@/config/contracts";
import { getBlockNumbers, clearBlockNumberCache } from "@/lib/blockNumbering";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { waitForTransactionReceipt } from "wagmi/actions";
import { config } from "@/config/wagmi";

// V5 Registry ABI for createMyBlock
const REGISTRY_ABI = parseAbi([
  "function createMyBlock(address center) external returns (address)",
  "function userLevel(address user) external view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

interface Block {
  id: string;
  block_number: number;
  /** Número relativo dentro del nivel (1..N) */
  level_block_number?: number;
  level_id: number;
  current_members: number;
  status: string;
  creator_id: string;
  contract_address: string | null;
  levels: {
    name: string;
    required_members: number;
    contribution_amount: number;
  };
}

interface UserWallet {
  id: string;
  wallet_address: string;
}

interface Level {
  id: number;
  name: string;
  contribution_amount: number;
  required_members: number;
}

interface WalletLevelProgress {
  wallet_address: string;
  level_id: number;
  status: string;
}

// Level config for on-chain data
const LEVEL_CONFIG: Record<number, { name: string; requiredMembers: number; contributionAmount: number }> = {
  1: { name: "Curioso", requiredMembers: 9, contributionAmount: 20 },
  2: { name: "Soñador", requiredMembers: 8, contributionAmount: 50 },
  3: { name: "Novato", requiredMembers: 7, contributionAmount: 100 },
  4: { name: "Aprendiz", requiredMembers: 6, contributionAmount: 250 },
  5: { name: "Asesor", requiredMembers: 5, contributionAmount: 500 },
  6: { name: "Maestro", requiredMembers: 4, contributionAmount: 1000 },
  7: { name: "Leyenda", requiredMembers: 3, contributionAmount: 2500 },
};

// Adapter: Convert on-chain block to UI block
// isOwner flag determines if the user owns this block or is just a member
const onChainBlockToUI = (data: OnChainBlockData, userId: string, isOwner: boolean, blockNum?: number): Block => ({
  id: data.address,
  block_number: blockNum ?? 0,
  level_block_number: blockNum ?? 0,
  level_id: data.levelId,
  current_members: data.membersCount,
  status: data.status === 0 ? "active" : "completed",
  creator_id: isOwner ? userId : data.owner, // Mark ownership correctly
  contract_address: data.address,
  levels: {
    name: LEVEL_CONFIG[data.levelId]?.name || `Nivel ${data.levelId}`,
    required_members: LEVEL_CONFIG[data.levelId]?.requiredMembers || 9,
    contribution_amount: LEVEL_CONFIG[data.levelId]?.contributionAmount || 20,
  },
});

const MyBlocks = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { address: account, isConnecting } = useAccount();
  const { address: reownAccount } = useAppKitAccount();
  const { open: openAppKit } = useAppKit();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { getUserBlocks, getUserMemberships, getUserLevel, isReady: onChainReady } = useOnChainData();
  
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [userWallets, setUserWallets] = useState<UserWallet[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [walletProgress, setWalletProgress] = useState<WalletLevelProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [selectedLevelId, setSelectedLevelId] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);
  const [onChainLevel, setOnChainLevel] = useState<number>(0);
  const [useOnChainMode, setUseOnChainMode] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string>("0");

  const connectedWallet = reownAccount || account;

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    loadData();
  }, [user, authLoading, navigate, connectedWallet]);

  // Fetch balance for connected wallet
  useEffect(() => {
    const fetchBalance = async () => {
      if (!publicClient || !connectedWallet || !USDT_TOKEN_ADDRESS) return;
      try {
        const [balance, decimals] = await Promise.all([
          (publicClient as any).readContract({
            address: USDT_TOKEN_ADDRESS as Address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [connectedWallet as Address],
          }),
          (publicClient as any).readContract({
            address: USDT_TOKEN_ADDRESS as Address,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
        ]);
        setWalletBalance(formatUnits(balance, decimals));
      } catch {
        setWalletBalance("0");
      }
    };
    fetchBalance();
  }, [publicClient, connectedWallet]);

  const loadData = async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);

    try {
      // Try on-chain data first
      if (onChainReady && connectedWallet) {
        try {
          const level = await getUserLevel(connectedWallet as Address);
          setOnChainLevel(level);
          
          if (level > 0) {
            setUseOnChainMode(true);
            
            // Get blocks created by user (isOwner = true)
            const onChainBlocks = await getUserBlocks(connectedWallet as Address);
            
            // Get blocks where user is a member (not owner) (isOwner = false)
            const membershipBlocks = await getUserMemberships(connectedWallet as Address);
            
            // Fetch consecutive block numbers from Subgraph
            const allOnChain = [...onChainBlocks, ...membershipBlocks];
            const blockNumMap = await getBlockNumbers(
              allOnChain.map(b => ({ address: b.address, levelId: b.levelId }))
            );
            
            const createdBlocks = onChainBlocks.map(b =>
              onChainBlockToUI(b, user.id, true, blockNumMap.get(b.address.toLowerCase()))
            );
            const memberBlocks = membershipBlocks.map(b =>
              onChainBlockToUI(b, user.id, false, blockNumMap.get(b.address.toLowerCase()))
            );
            
            // Combine - no need to deduplicate since getUserMemberships excludes owned blocks
            const allBlocks = [...createdBlocks, ...memberBlocks];
            
            setBlocks(allBlocks);
            console.log('[MyBlocks] On-chain blocks:', createdBlocks.length, 'created,', memberBlocks.length, 'memberships');
            
            // Still load levels and wallets from DB for UI
            await loadLevelsAndWallets();
            return;
          }
        } catch (err) {
          console.warn('[MyBlocks] On-chain read failed:', err);
        }
      }
      
      // If no on-chain data, show empty state
      setUseOnChainMode(false);
      await loadLevelsAndWallets();
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadLevelsAndWallets = async () => {
    if (!user) return;
    
    // Load user wallets (only active ones)
    const { data: walletsData, error: walletsError } = await supabase
      .from('user_wallets')
      .select('id, wallet_address')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (walletsError) throw walletsError;
    console.log('Wallets loaded:', walletsData);
    setUserWallets(walletsData || []);
      
    // Load levels
    const { data: levelsData, error: levelsError } = await supabase
      .from('levels')
      .select('id, name, contribution_amount, required_members')
      .order('sort_order');

    if (levelsError) throw levelsError;
    setLevels(levelsData || []);
  };

  // Auto-refresh blocks data every 15 seconds (silent, no spinner)
  const autoRefreshBlocks = useCallback(() => {
    if (user && !isCreating) loadData(true);
  }, [user, connectedWallet, onChainReady, isCreating]);
  useAutoRefresh(autoRefreshBlocks, 15000, !!user);

  // Manual refresh handler for button
  const handleManualRefresh = useCallback(() => {
    loadData();
  }, [user, connectedWallet, onChainReady]);

  const handleCreateBlock = async () => {
    if (!user || !connectedWallet) return;

    // V5: createMyBlock creates a block at the user's current on-chain level
    if (onChainLevel < 1) {
      toast.error("Debes registrarte primero antes de crear un bloque");
      return;
    }

    setIsCreating(true);
    const toastId = toast.loading("Creando bloque en blockchain...");

    try {
      // V5: createMyBlock(center) — creates a personal block at user's current level
      const txHash = await writeContractAsync({
        address: CONTRACTS.REGISTRY as Address,
        abi: REGISTRY_ABI,
        functionName: "createMyBlock",
        args: [connectedWallet as Address],
        gas: 5_000_000n,
      } as any);

      toast.loading("Confirmando transacción...", { id: toastId });

      const receipt = await waitForTransactionReceipt(config, {
        hash: txHash,
      });

      if (receipt.status === "reverted") {
        throw new Error("La transacción fue revertida");
      }

      toast.success("¡Bloque creado exitosamente!", { id: toastId });
      setShowCreateDialog(false);
      
      // Reload data
      clearBlockNumberCache();
      loadData();
    } catch (error: any) {
      console.error('Error creating block:', error);
      const msg = error?.shortMessage || error?.message || "Error al crear el bloque";
      toast.error(msg, { id: toastId });
    } finally {
      setIsCreating(false);
    }
  };

  // Filter blocks by wallet ownership
  const getBlocksForWallet = (walletAddress: string) => {
    // In on-chain mode, all blocks belong to connected wallet
    if (useOnChainMode) {
      return blocks.filter(b => b.creator_id === user?.id);
    }
    // Legacy: filter by contract_address existence (block was created by this wallet)
    return blocks.filter(b => b.creator_id === user?.id);
  };

  // Check if a wallet can create a block at a specific level
  const canCreateBlockAtLevel = (walletAddress: string, levelId: number): { canCreate: boolean; reason?: string } => {
    // Check if user already has a block at this level (using connected wallet in on-chain mode)
    const existingBlockAtLevel = blocks.find(b => b.level_id === levelId && b.creator_id === user?.id);
    
    if (existingBlockAtLevel) {
      return { 
        canCreate: false, 
        reason: `Ya tienes un bloque en Nivel ${levelId} con esta wallet` 
      };
    }

    if (levelId === 1) {
      // Level 1 is available if no existing block
      return { canCreate: true };
    }

    // For levels > 1, need to have completed the previous level
    const previousLevelId = levelId - 1;
    
    // In on-chain mode, check on-chain level
    if (useOnChainMode && onChainLevel >= previousLevelId) {
      return { canCreate: true };
    }
    
    // Fallback: check walletProgress from DB
    const previousProgress = walletProgress.find(
      p => p.level_id === previousLevelId
    );

    if (!previousProgress || previousProgress.status !== 'completed') {
      return { 
        canCreate: false, 
        reason: `Debes completar el Nivel ${previousLevelId} primero` 
      };
    }

    return { canCreate: true };
  };

  const participatingBlocks = blocks.filter(b => b.creator_id !== user?.id);

  const handleConnectWallet = () => {
    openAppKit();
  };

  return (
    <div className="min-h-screen pb-24 bg-background">
      <Navigation />
      
      <div className="container mx-auto px-4 pt-20">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Gestiona tus bloques creados y los que integras
            </p>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost"
                size="sm"
                onClick={handleManualRefresh}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {onChainLevel > 0 && (
                <Button 
                  onClick={() => setShowCreateDialog(true)}
                  size="sm"
                  className="bg-primary hover:bg-primary/90"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Crear
                </Button>
              )}
            </div>
          </div>

          <Tabs defaultValue="created" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-muted/50">
              <TabsTrigger value="created">Mis Bloques</TabsTrigger>
              <TabsTrigger value="participating">Donde participo</TabsTrigger>
            </TabsList>

            <TabsContent value="created" className="space-y-4 mt-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : userWallets.length === 0 ? (
                useOnChainMode && blocks.length > 0 ? (
                  // On-chain mode: show blocks directly grouped by connected wallet
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-2">
                      <Wallet className="w-4 h-4 text-primary" />
                      <span className="text-sm font-mono">
                        {connectedWallet?.slice(0, 6)}...{connectedWallet?.slice(-4)}
                      </span>
                      <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                        On-chain
                      </span>
                    </div>
                    
                    {blocks.filter(b => b.creator_id === user?.id).length === 0 ? (
                      <Card className="p-6 text-center bg-card-light/50 border border-dashed">
                        <p className="text-sm text-muted-foreground">Sin bloques creados con esta wallet</p>
                      </Card>
                    ) : (
                      blocks.filter(b => b.creator_id === user?.id).map((block) => (
                        <Card key={block.id} className="p-5 bg-card text-card-foreground rounded-xl">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-base font-bold">Bloque #{block.level_block_number ?? block.block_number}</span>
                              <LevelBadge level={block.level_id} name={block.levels.name} />
                            </div>
                            
                            <div className="grid grid-cols-3 gap-3 text-sm">
                              <div>
                                <p className="text-xs text-muted-foreground">Aporte</p>
                                <p className="font-bold">{block.levels.contribution_amount} USDT</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Miembros</p>
                                <p className="font-bold">{block.current_members}/{block.levels.required_members}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Estado</p>
                                <p className={`font-bold text-sm ${block.status === 'active' ? 'text-success' : block.status === 'completed' ? 'text-info' : 'text-destructive'}`}>
                                  {block.status === 'active' ? 'Activo' : block.status === 'completed' ? 'Completado' : 'Cancelado'}
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <Button 
                                onClick={() => navigate(`/block/${block.contract_address || block.id}`)}
                                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
                              >
                                Ver detalles
                              </Button>
                              {block.status === 'active' && (
                                <Button 
                                  variant="outline"
                                  onClick={() => navigate(`/invite/${block.contract_address || block.id}`)}
                                  className="flex-1 border-2 rounded-lg"
                                >
                                  Invitar
                                </Button>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                ) : !connectedWallet ? (
                  <Card className="p-12 text-center bg-card-light text-card-light-foreground border-2 border-dashed">
                    <p className="text-muted-foreground mb-4">Conecta tu wallet para ver tus bloques</p>
                    <Button onClick={handleConnectWallet} disabled={isConnecting}>
                      {isConnecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
                      Conectar Wallet
                    </Button>
                  </Card>
                ) : (
                  <Card className="p-12 text-center bg-card-light text-card-light-foreground border-2 border-dashed">
                    <p className="text-muted-foreground mb-2">No tienes wallets registradas</p>
                    <p className="text-xs text-muted-foreground">
                      Wallet conectada: {connectedWallet?.slice(0, 6)}...{connectedWallet?.slice(-4)}
                    </p>
                    <Button 
                      className="mt-4"
                      onClick={() => navigate('/manage-wallets')}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Agregar Wallet
                    </Button>
                  </Card>
                )
              ) : useOnChainMode && blocks.length > 0 ? (
                // On-chain mode with registered wallets: show on-chain blocks
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-2">
                    <Wallet className="w-4 h-4 text-primary" />
                    <span className="text-sm font-mono">
                      {connectedWallet?.slice(0, 6)}...{connectedWallet?.slice(-4)}
                    </span>
                    <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                      On-chain
                    </span>
                  </div>
                  
                  {blocks.filter(b => b.creator_id === user?.id).map((block) => (
                    <Card key={block.id} className="p-5 bg-card text-card-foreground rounded-xl">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-bold">Bloque #{block.level_block_number ?? block.block_number}</span>
                          <LevelBadge level={block.level_id} name={block.levels.name} />
                        </div>
                        
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Aporte</p>
                            <p className="font-bold">{block.levels.contribution_amount} USDT</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Miembros</p>
                            <p className="font-bold">{block.current_members}/{block.levels.required_members}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Estado</p>
                            <p className={`font-bold text-sm ${block.status === 'active' ? 'text-success' : block.status === 'completed' ? 'text-info' : 'text-destructive'}`}>
                              {block.status === 'active' ? 'Activo' : block.status === 'completed' ? 'Completado' : 'Cancelado'}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button 
                            onClick={() => navigate(`/block/${block.contract_address || block.id}`)}
                            className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
                          >
                            Ver detalles
                          </Button>
                          {block.status === 'active' && (
                            <Button 
                              variant="outline"
                              onClick={() => navigate(`/invite/${block.contract_address || block.id}`)}
                              className="flex-1 border-2 rounded-lg"
                            >
                              Invitar
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                userWallets.map((wallet) => {
                  const walletBlocks = getBlocksForWallet(wallet.id);
                  return (
                    <div key={wallet.id} className="space-y-3">
                      <div className="flex items-center gap-2 px-2">
                        <Wallet className="w-4 h-4 text-primary" />
                        <span className="text-sm font-mono">
                          {wallet.wallet_address.slice(0, 6)}...{wallet.wallet_address.slice(-4)}
                        </span>
                      </div>
                      
                      {walletBlocks.length === 0 ? (
                        <Card className="p-6 text-center bg-card-light/50 border border-dashed">
                          <p className="text-sm text-muted-foreground">Sin bloques creados con esta wallet</p>
                        </Card>
                      ) : (
                        walletBlocks.map((block) => (
                          <Card key={block.id} className="p-5 bg-card text-card-foreground rounded-xl">
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-base font-bold">Bloque #{block.level_block_number ?? block.block_number}</span>
                                <LevelBadge level={block.level_id} name={block.levels.name} />
                              </div>
                              
                              <div className="grid grid-cols-3 gap-3 text-sm">
                                <div>
                                  <p className="text-xs text-muted-foreground">Aporte</p>
                                  <p className="font-bold">{block.levels.contribution_amount} USDT</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Miembros</p>
                                  <p className="font-bold">{block.current_members}/{block.levels.required_members}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Estado</p>
                                  <p className={`font-bold text-sm ${block.status === 'active' ? 'text-success' : block.status === 'completed' ? 'text-info' : 'text-destructive'}`}>
                                    {block.status === 'active' ? 'Activo' : block.status === 'completed' ? 'Completado' : 'Cancelado'}
                                  </p>
                                </div>
                              </div>

                              <div className="flex gap-2">
                                <Button 
                                  onClick={() => navigate(`/block/${block.id}`)}
                                  className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
                                >
                                  Ver detalles
                                </Button>
                                {block.status === 'active' && (
                                  <Button 
                                    variant="outline"
                                    onClick={() => navigate(`/invite/${block.id}`)}
                                    className="flex-1 border-2 rounded-lg"
                                  >
                                    Invitar
                                  </Button>
                                )}
                              </div>
                            </div>
                          </Card>
                        ))
                      )}
                    </div>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="participating" className="space-y-3 mt-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : participatingBlocks.length === 0 ? (
                <Card className="p-12 text-center bg-card-light text-card-light-foreground border-2 border-dashed">
                  <p className="text-muted-foreground">No participas en ningún bloque</p>
                </Card>
              ) : (
                participatingBlocks.map((block) => (
                  <Card key={block.id} className="p-5 bg-card text-card-foreground rounded-xl">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-base font-bold">Bloque #{block.level_block_number ?? block.block_number}</span>
                        <LevelBadge level={block.level_id} name={block.levels.name} />
                      </div>
                      
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Aporte</p>
                          <p className="font-bold">{block.levels.contribution_amount} USDT</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Miembros</p>
                          <p className="font-bold">{block.current_members}/{block.levels.required_members}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Estado</p>
                          <p className={`font-bold text-sm ${block.status === 'active' ? 'text-success' : block.status === 'completed' ? 'text-info' : 'text-destructive'}`}>
                            {block.status === 'active' ? 'Activo' : block.status === 'completed' ? 'Completado' : 'Cancelado'}
                          </p>
                        </div>
                      </div>

                      <Button 
                        onClick={() => navigate(`/block/${block.contract_address || block.id}`)}
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
                      >
                        Ver detalles
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Create Block Dialog — V5: createMyBlock at current on-chain level */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Bloque</DialogTitle>
            <DialogDescription>
              Se creará un bloque en tu nivel actual (Nivel {onChainLevel} — {LEVEL_CONFIG[onChainLevel]?.name || "?"})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-muted/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Nivel:</span>
                <span className="font-bold text-primary">
                  {onChainLevel} — {LEVEL_CONFIG[onChainLevel]?.name || "?"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Wallet:</span>
                <code className="font-mono text-sm">
                  {connectedWallet?.slice(0, 6)}...{connectedWallet?.slice(-4)}
                </code>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tu balance:</span>
                <span className="font-mono font-semibold">
                  {parseFloat(walletBalance).toFixed(2)} USDT
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              <strong>Nota:</strong> createMyBlock es una operación gratuita (sin costo de tokens). Solo requiere gas para la transacción.
            </p>

            <Button 
              onClick={handleCreateBlock}
              disabled={isCreating || !connectedWallet}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creando...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Crear Bloque
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyBlocks;
