import { useEffect, useState } from "react";
import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LevelBadge } from "@/components/LevelBadge";
import { Loader2, Users, Wallet, RefreshCw, UserPlus, HelpCircle, Copy, Share2, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useReadContract } from "wagmi";
import { PaymentCard } from "@/components/PaymentCard";
import { JoinBlockCard } from "@/components/JoinBlockCard";
import { USDT_TOKEN_ADDRESS } from "@/config/contracts";
import { toast } from "sonner";
import WalletTutorialModal from "@/components/WalletTutorialModal";
import { ReownManageWalletButton, ReownAddFundsButton } from "@/components/ReownWalletActions";
 import { useOnChainData, type OnChainBlockData } from "@/hooks/useOnChainData";
 import { useSubgraphQuery } from "@/hooks/useSubgraphQuery";
 import type { Address } from "viem";
import type { SubgraphBlock } from "@/config/subgraph";

interface Block {
  id: string;
  block_number: number;
  level_id: number;
  current_members: number;
  status: string;
  creator_id: string;
  relative_block_number?: number;
  levels: {
    name: string;
    required_members: number;
    contribution_amount: number;
  };
}

 // Level names mapping
 const LEVEL_NAMES: Record<number, string> = {
   1: "Curioso",
   2: "Soñador", 
   3: "Novato",
   4: "Aprendiz",
   5: "Asesor",
   6: "Maestro",
   7: "Leyenda",
 };
 
 // Level config (contribution amounts in USDT)
 const LEVEL_CONFIG: Record<number, { requiredMembers: number; contributionAmount: number }> = {
   1: { requiredMembers: 9, contributionAmount: 20 },
   2: { requiredMembers: 8, contributionAmount: 50 },
   3: { requiredMembers: 7, contributionAmount: 100 },
   4: { requiredMembers: 6, contributionAmount: 250 },
   5: { requiredMembers: 5, contributionAmount: 500 },
   6: { requiredMembers: 4, contributionAmount: 1000 },
   7: { requiredMembers: 3, contributionAmount: 2500 },
 };
 
 // Adapter: Convert on-chain block data to UI Block format
 const onChainBlockToUIBlock = (data: OnChainBlockData, index: number): Block => ({
   id: data.address,
   block_number: index + 1,
   level_id: data.levelId,
   current_members: data.membersCount,
   status: data.status === 0 ? "active" : "completed",
   creator_id: data.owner,
   relative_block_number: index + 1,
   levels: {
     name: LEVEL_NAMES[data.levelId] || `Nivel ${data.levelId}`,
     required_members: LEVEL_CONFIG[data.levelId]?.requiredMembers || 9,
     contribution_amount: LEVEL_CONFIG[data.levelId]?.contributionAmount || 20,
   },
 });
 
 // Adapter: Convert subgraph membership to UI Block format
 const subgraphMembershipToUIBlock = (block: SubgraphBlock, position: number, index: number): Block => ({
   id: block.id,
   block_number: index + 1,
   level_id: block.levelId,
   current_members: block.members?.length || 0,
   status: block.status === 0 ? "active" : "completed",
   creator_id: block.owner?.id || "",
   relative_block_number: position,
   levels: {
     name: LEVEL_NAMES[block.levelId] || `Nivel ${block.levelId}`,
     required_members: LEVEL_CONFIG[block.levelId]?.requiredMembers || 9,
     contribution_amount: LEVEL_CONFIG[block.levelId]?.contributionAmount || 20,
   },
 });
 
const Dashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlRef = searchParams.get('ref');
  const referralCode = urlRef || localStorage.getItem('referralCode');

  // When a new referral code arrives via URL, clear stale referrer context
  // so PaymentCard/JoinBlockCard re-resolve from the fresh code
  useEffect(() => {
    if (urlRef) {
      const storedRef = localStorage.getItem('referralCode');
      if (storedRef !== urlRef) {
        localStorage.removeItem('referrerSourceWalletAddress');
        localStorage.removeItem('referrerSourceBlockId');
      }
      localStorage.setItem('referralCode', urlRef);
    }
  }, [urlRef]);
  const { user, loading: authLoading } = useAuth();
  
  // Reown/Wagmi hooks for wallet management
  const { open } = useAppKit();
  const { address: account, isConnected } = useAppKitAccount();
   
   // On-chain data hooks
   const { getUserBlocks, getUserLevel, getReferralCode, isReady: onChainReady } = useOnChainData();
  const { isSubgraphAvailable, fetchUserBlocks } = useSubgraphQuery();
   
  // Use USDT test token contract for balance (6 decimals)
  const { data: tokenBalance } = useReadContract({
    address: USDT_TOKEN_ADDRESS,
    abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
    functionName: 'balanceOf',
    args: account ? [account as `0x${string}`] : undefined,
    query: { enabled: !!account },
  });
  const balance = tokenBalance ? (Number(tokenBalance) / 1e6).toFixed(2) : "0";

  const [loading, setLoading] = useState(true);
  const [createdBlocks, setCreatedBlocks] = useState<Block[]>([]);
  const [participatingBlocks, setParticipatingBlocks] = useState<Block[]>([]);
  const [lastDeposit, setLastDeposit] = useState<number>(0);
  const [lastDepositDate, setLastDepositDate] = useState<string>("");
  const [lastDepositType, setLastDepositType] = useState<string>("");
  const [currentBalance, setCurrentBalance] = useState<number>(0);
  const [pendingPayment, setPendingPayment] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [walletNotRegistered, setWalletNotRegistered] = useState(false);
  const [hasNoBlocks, setHasNoBlocks] = useState(false);
  const [userReferralCode, setUserReferralCode] = useState<string | null>(null);
  const [copiedReferral, setCopiedReferral] = useState(false);
   const [onChainLevel, setOnChainLevel] = useState<number>(0);
   const [useOnChainMode, setUseOnChainMode] = useState(false);

  const REFERRAL_BASE_URL = "https://cundinablock.com/dashboard";
  
  useRealtimeNotifications();
  
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    loadDashboardData();
  }, [user, authLoading, navigate, account, isConnected]);

  const loadDashboardData = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setWalletNotRegistered(false);
      setHasNoBlocks(false);

      // If no wallet connected, reset all data
      if (!account) {
        setCreatedBlocks([]);
        setParticipatingBlocks([]);
        setPendingPayment(false);
        setLastDeposit(0);
        setLastDepositDate("");
        setLastDepositType("");
        setCurrentBalance(0);
         setOnChainLevel(0);
        return;
      }

       // Try on-chain data first
       if (onChainReady) {
         try {
           const level = await getUserLevel(account as Address);
           setOnChainLevel(level);
           
           if (level > 0) {
             // User is registered on-chain - load blocks from chain
             setUseOnChainMode(true);
             const onChainBlocks = await getUserBlocks(account as Address);
             
             // Convert to UI format
             const uiBlocks = onChainBlocks.map((b, idx) => onChainBlockToUIBlock(b, idx));
             setCreatedBlocks(uiBlocks);
             
             // Try to get memberships from subgraph
             try {
               const subgraphUser = await fetchUserBlocks(account.toLowerCase());
               if (subgraphUser?.memberships && subgraphUser.memberships.length > 0) {
                 const memberBlocks = subgraphUser.memberships
                   .filter(m => m.block && m.block.owner?.id?.toLowerCase() !== account.toLowerCase())
                   .map((m, idx) => subgraphMembershipToUIBlock(m.block!, m.position, idx));
                 setParticipatingBlocks(memberBlocks);
               } else {
                 setParticipatingBlocks([]);
               }
              } catch (subgraphErr) {
                console.warn('[Dashboard] Subgraph membership query failed:', subgraphErr);
                setParticipatingBlocks([]);
              }
             
             setHasNoBlocks(uiBlocks.length === 0);
             setWalletNotRegistered(false);
             
             // Try to get referral code from chain
             const refCode = await getReferralCode(account as Address);
             if (refCode) {
                // On-chain referral code (already converted from bytes32)
                setUserReferralCode(refCode);
             } else {
              // No on-chain referral code
               // Use wallet address as referral code - 100% decentralized
               setUserReferralCode(account);
               }
              
              return;
            }
            
            // User not registered on-chain yet
            setWalletNotRegistered(true);
            setCreatedBlocks([]);
            setParticipatingBlocks([]);
            setHasNoBlocks(true);
          } catch (err) {
            console.warn('[Dashboard] On-chain read failed:', err);
            setWalletNotRegistered(true);
            setCreatedBlocks([]);
            setParticipatingBlocks([]);
          }
        }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };
  
  // Transaction history is now 100% on-chain (Etherscan/Subgraph)
  // No Supabase fallback needed
   
  if (loading) {
    return <div className="min-h-screen pb-24 flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>;
  }
  return <div className="min-h-screen pb-24 bg-background">
      <Navigation />
      
      <div className="container mx-auto px-4 pt-20">
        <div className="space-y-4">
          {/* Header with refresh */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Panel de control de tu wallet conectada</p>
            <Button variant="ghost" size="sm" onClick={loadDashboardData} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Wallet Info */}
          {account ? <Card className="p-4 bg-card text-card-foreground rounded-xl">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-primary" />
                    <span className="text-sm font-semibold">Wallet Conectada</span>
                  </div>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => open?.()} className="h-8">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      <span className="text-xs">Cambiar Wallet</span>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-mono">
                    {account.slice(0, 6)}...{account.slice(-4)}
                  </span>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Saldo USDT</p>
                    <p className="text-xl font-bold text-primary">{parseFloat(balance).toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </Card> : <Card className="p-5 bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 text-card-foreground rounded-xl">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center">
                    <Wallet className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">¡Conecta tu Billetera!</h3>
                    <p className="text-sm text-muted-foreground">
                      Necesitas una billetera Web3 para participar en Cundina Block
                    </p>
                  </div>
                </div>
                
                <div className="flex flex-col gap-2">
                  <Button onClick={() => open?.()} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                    <Wallet className="w-4 h-4 mr-2" />
                    Conectar Billetera
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setShowTutorial(true)}
                    className="w-full"
                  >
                    <HelpCircle className="w-4 h-4 mr-2" />
                    ¿No tienes billetera? Ver Tutorial
                  </Button>
                </div>
              </div>
            </Card>}

          <p className="text-sm text-muted-foreground">Empieza a subir de nivel y alcanza tus metas con la comunidad</p>

          {/* Balance Cards */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4 bg-card text-card-foreground rounded-xl">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Ultimo deposito</p>
                <p className="text-xl font-bold">{lastDeposit} USDT</p>
                {lastDepositDate && <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(lastDepositDate).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  })}
                    </p>
                    <p className="text-[10px] text-muted-foreground capitalize">
                      {lastDepositType === 'payment' ? 'Pago' : lastDepositType === 'deposit' ? 'Depósito' : 'Recompensa'}
                    </p>
                  </div>}
              </div>
            </Card>
            <Card className="p-4 bg-card text-card-foreground rounded-xl">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Saldo actual</p>
                <p className="text-xl font-bold">{currentBalance} USDT</p>
              </div>
            </Card>
          </div>

          {/* Compact Referral Sharing */}
          {userReferralCode && (
            <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <Share2 className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Tu código de referido</p>
                <p className="font-mono font-bold text-sm truncate">{userReferralCode}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 h-8 px-2"
                onClick={async () => {
                  const link = `${REFERRAL_BASE_URL}?ref=${userReferralCode}`;
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopiedReferral(true);
                    toast.success("¡Enlace copiado!");
                    setTimeout(() => setCopiedReferral(false), 2000);
                  } catch {
                    toast.error("No se pudo copiar");
                  }
                }}
              >
                {copiedReferral ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 h-8 px-2"
                onClick={async () => {
                  const link = `${REFERRAL_BASE_URL}?ref=${userReferralCode}`;
                  const shareData = {
                    title: "Únete a CundinaBlock",
                    text: "¡Únete a CundinaBlock con mi código!",
                    url: link,
                  };
                  try {
                    if (navigator.share && navigator.canShare(shareData)) {
                      await navigator.share(shareData);
                    } else {
                      await navigator.clipboard.writeText(link);
                      toast.success("¡Enlace copiado!");
                    }
                  } catch (err) {
                    if ((err as Error).name !== 'AbortError') {
                      await navigator.clipboard.writeText(link);
                      toast.success("¡Enlace copiado!");
                    }
                  }
                }}
              >
                <Share2 className="w-4 h-4" />
              </Button>
            </div>
          )}

          {createdBlocks.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                Mis Bloques Creados
              </h3>
              {createdBlocks.map((block) => (
                <Card key={block.id} className="p-4 bg-card text-card-foreground rounded-xl">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">Bloque #{block.relative_block_number || block.block_number}</span>
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
                        <p className={`font-bold text-xs ${block.status === 'active' ? 'text-success' : block.status === 'completed' ? 'text-info' : 'text-muted-foreground'}`}>
                          {block.status === 'active' ? 'Activo' : block.status === 'completed' ? 'Completado' : 'Cancelado'}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={() => navigate(`/block/${block.id}`)} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg" size="sm">
                        Ver detalles
                      </Button>
                      {block.status === 'active' && (
                        <Button variant="outline" onClick={() => navigate(`/invite/${block.id}`)} className="flex-1 border-2 rounded-lg" size="sm">
                          Invitar
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Bloques donde Participo */}
          {participatingBlocks.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-base font-bold flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-info" />
                Bloques donde Participo
              </h3>
              {participatingBlocks.map((block) => (
                <Card key={block.id} className="p-4 bg-info/5 border-info/20 text-card-foreground rounded-xl">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">Bloque #{block.relative_block_number || block.block_number}</span>
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
                        <p className={`font-bold text-xs ${block.status === 'active' ? 'text-success' : block.status === 'completed' ? 'text-info' : 'text-muted-foreground'}`}>
                          {block.status === 'active' ? 'Activo' : block.status === 'completed' ? 'Completado' : 'Cancelado'}
                        </p>
                      </div>
                    </div>

                    <Button onClick={() => navigate(`/block/${block.id}`)} className="w-full bg-info hover:bg-info/90 text-info-foreground rounded-lg" size="sm">
                      Ver detalles
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Wallet Not Registered - Needs to make initial contribution */}
          {account && walletNotRegistered && user && (
            <div className="space-y-4">
              <Card className="p-5 bg-gradient-to-br from-warning/20 to-warning/5 border-warning/30 text-card-foreground rounded-xl">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-warning/20 rounded-full flex items-center justify-center">
                      <Wallet className="w-6 h-6 text-warning" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">Wallet Nueva</h3>
                      <p className="text-sm text-muted-foreground">
                        Esta billetera no está registrada. Realiza tu aportación inicial de $20 USDT para comenzar.
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              <h3 className="text-lg font-bold">Comienza con esta wallet</h3>
              
              <div className="grid gap-4">
                <PaymentCard 
                  userId={user.id} 
                  walletAddress={account || null} 
                  amount={20} 
                  levelId={1} 
                  onPaymentSuccess={loadDashboardData} 
                  referralCode={referralCode} 
                />

                <JoinBlockCard 
                  userId={user.id} 
                  walletAddress={account || null} 
                  onJoinSuccess={loadDashboardData} 
                />
              </div>
            </div>
          )}

          {/* Wallet Registered but has no blocks - show options */}
          {account && !walletNotRegistered && user && hasNoBlocks && (
            <div className="space-y-4">
              <Card className="p-5 bg-gradient-to-br from-info/20 to-info/5 border-info/30 text-card-foreground rounded-xl">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-info/20 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-info" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">¡Empieza tu camino!</h3>
                      <p className="text-sm text-muted-foreground">
                        Realiza tu aportación de $20 USDT para crear o unirte a un bloque.
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              <h3 className="text-lg font-bold">Comenzá tu primer bloque</h3>
              
              <div className="grid gap-4">
                <PaymentCard 
                  userId={user.id} 
                    walletAddress={account || null}
                  amount={20} 
                  levelId={1} 
                  onPaymentSuccess={loadDashboardData} 
                  referralCode={referralCode} 
                />

                <JoinBlockCard 
                  userId={user.id} 
                      walletAddress={account || null}
                  onJoinSuccess={loadDashboardData} 
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <WalletTutorialModal open={showTutorial} onOpenChange={setShowTutorial} />
    </div>;
};
export default Dashboard;