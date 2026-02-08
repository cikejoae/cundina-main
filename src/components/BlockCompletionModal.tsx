import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, TrendingUp, LogOut, ArrowRight, Wallet, Gift, AlertCircle } from "lucide-react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { decodeEventLog, formatUnits, parseUnits, parseAbi, type Address } from 'viem';
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CONTRACTS, USDT_TOKEN_ADDRESS } from "@/config/contracts";

// ABIs
const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

// Registry ABI for the new EOA Treasury architecture
const REGISTRY_ABI = parseAbi([
  'function createMyBlock(address center) external returns (address)',
  'function userLevel(address user) external view returns (uint256)',
  'function myBlockAtLevel(address user, uint256 level) external view returns (address)',
  'function findTopBlockAtLevel(uint256 level) external view returns (address topBlock, address topBlockCreator)',
  'function joinTargetBlock(address member, address targetBlock) external',
  'event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress)',
]);

// PayoutModule ABI for advance/cashout operations
const PAYOUT_MODULE_ABI = parseAbi([
  'function advance(address blockAddr, address center, address payoutTo) external returns (address nextBlock)',
  'function cashout(address blockAddr, address center, address payoutTo) external',
  'event AdvanceExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo, address nextBlock)',
  'event CashoutExecuted(address indexed center, address indexed blockAddr, uint256 payout, address payoutTo)',
]);

// Block ABI for reading status/owner
const BLOCK_ABI = parseAbi([
  'function owner() view returns (address)',
  'function status() view returns (uint8)',
  'function levelId() view returns (uint256)',
  'function membersCount() view returns (uint256)',
]);

interface BlockCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  walletAddress: string;
  currentLevelId: number;
  currentLevelName: string;
  totalEarnings: number;
  nextLevelContribution: number | null;
  nextLevelName: string | null;
  nextLevelId: number | null;
  contractAddress: string;
  onSuccess: () => void;
}

// Dispersión de fondos según especificación
interface LevelDistribution {
  advanceContribution: number;  // Aporte al bloque TOP del siguiente nivel
  advanceCommission: number;    // 10% comisión a billetera de comisiones
  advanceToWallet: number;      // Resto a billetera del miembro
}

export const BlockCompletionModal = ({
  isOpen,
  onClose,
  userId,
  walletAddress,
  currentLevelId,
  currentLevelName,
  totalEarnings,
  nextLevelContribution,
  nextLevelName,
  nextLevelId,
  contractAddress,
  onSuccess,
}: BlockCompletionModalProps) => {
  const { address: account, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [isProcessing, setIsProcessing] = useState(false);
  const [action, setAction] = useState<"advance" | "withdraw" | null>(null);
  const [distribution, setDistribution] = useState<LevelDistribution | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [onchainOwner, setOnchainOwner] = useState<string | null>(null);
  const [ownershipMismatch, setOwnershipMismatch] = useState(false);

  const { data: tokenDecimals } = useReadContract({
    address: USDT_TOKEN_ADDRESS,
    abi: ERC20_ABI as any,
    functionName: 'decimals',
    chainId: chain?.id,
    query: { enabled: true },
  });

  const decimals = typeof tokenDecimals === 'number' ? tokenDecimals : 18;
  // NOTE: TOP block lookup is done 100% on-chain via registry.findTopBlockAtLevel()
  // in the handleAdvance flow (Step 1.5). No Supabase dependency for this.

  const waitForTx = async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error('Cliente público no disponible');
    await publicClient.waitForTransactionReceipt({ hash });
  };

  const readBlockOwner = async (blockAddr: string): Promise<string> => {
    if (!publicClient) throw new Error('Cliente público no disponible');
    const owner = await (publicClient as any).readContract({
      address: blockAddr as `0x${string}`,
      abi: BLOCK_ABI,
      functionName: 'owner',
    });
    return String(owner);
  };

  // Fetch distribution values from database and verify ownership
  // We use walletAddress prop directly since the component already receives the verified owner
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setOwnershipMismatch(false);
      setOnchainOwner(null);

      // Fetch level distribution
      const { data, error } = await supabase
        .from('levels')
        .select('advance_contribution, advance_commission, advance_to_wallet')
        .eq('id', currentLevelId)
        .single();

      if (data && !error) {
        setDistribution({
          advanceContribution: Number(data.advance_contribution) || 0,
          advanceCommission: Number(data.advance_commission) || 0,
          advanceToWallet: Number(data.advance_to_wallet) || 0,
        });
      }

      // Verify ownership: walletAddress prop is the block owner
      if (walletAddress && account) {
        setOnchainOwner(walletAddress);
        if (walletAddress.toLowerCase() !== account.toLowerCase()) {
          setOwnershipMismatch(true);
        }
      }

      setIsLoading(false);
    };

    if (isOpen && currentLevelId) {
      fetchData();
    }
  }, [isOpen, currentLevelId, walletAddress, account]);

  const hasNextLevel = nextLevelId !== null && distribution !== null && distribution.advanceContribution > 0;
  const isLastLevel = currentLevelId === 7;

  // Helper function to transfer tokens
  const transferTokens = async (to: string, amount: string): Promise<string> => {
    if (!account) throw new Error('Wallet not connected');
    const amountWei = parseUnits(amount, decimals);
    const hash = await writeContractAsync({
      address: USDT_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to as `0x${string}`, amountWei],
      account,
      chain,
    });
    await waitForTx(hash);
    return hash;
  };

  // Helper function to approve tokens
  const approveTokens = async (spender: string, amount: string): Promise<string> => {
    if (!account) throw new Error('Wallet not connected');
    const amountWei = parseUnits(amount, decimals);
    const hash = await writeContractAsync({
      address: USDT_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender as `0x${string}`, amountWei],
      account,
      chain,
    });
    await waitForTx(hash);
    return hash;
  };

  // NOTE: With EOA Treasury architecture, there's no withdrawToCreator function on the block.
  // Payouts are handled by the TreasuryPayoutModule which pulls tokens from Treasury EOA.
  // The Treasury EOA must call cashout() or advance() on the PayoutModule.
  // For now, we'll just record the completion and let the Treasury handle payouts off-chain.

  // Helper function to get existing block at level from Registry
  const getExistingBlockAtLevel = async (levelId: number): Promise<string | null> => {
    if (!publicClient || !account) return null;
    try {
      const blockAddr = await (publicClient as any).readContract({
        address: CONTRACTS.REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'myBlockAtLevel',
        args: [account as `0x${string}`, BigInt(levelId)],
      });
      const addr = String(blockAddr || '');
      // Check if it's a valid address (not zero address)
      if (addr && addr !== '0x0000000000000000000000000000000000000000') {
        return addr;
      }
      return null;
    } catch (err) {
      console.warn('Error checking existing block at level:', err);
      return null;
    }
  };

  // Helper function to create block via Registry (or reuse existing)
  const createBlockOnChain = async (levelId: number): Promise<{ blockAddress: string; txHash: string }> => {
    if (!CONTRACTS.REGISTRY) {
      throw new Error('Registry contract not configured');
    }
    if (!account) throw new Error('Wallet not connected');
    
    // First check if user already has a block at this level on-chain
    const existingBlock = await getExistingBlockAtLevel(levelId);
    if (existingBlock) {
      console.log(`User already has block at level ${levelId}:`, existingBlock);
      // Return the existing block address (no new transaction needed)
      return { blockAddress: existingBlock, txHash: 'existing-block' };
    }
    
    const hash = await writeContractAsync({
      address: CONTRACTS.REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'createMyBlock',
      args: [account as `0x${string}`],
      account,
      chain,
      gas: BigInt(5_000_000), // Explicit gas limit for Sepolia (cap: 16.7M)
    });

    if (!publicClient) throw new Error('Cliente público no disponible');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let blockAddress: `0x${string}` | null = null;
    for (const log of receipt.logs as any[]) {
      if (!log?.address) continue;
      if (String(log.address).toLowerCase() !== String(CONTRACTS.REGISTRY).toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: REGISTRY_ABI as any,
          data: log.data,
          topics: log.topics,
        }) as any;
        if (decoded?.eventName === 'MyBlockCreated') {
          blockAddress = decoded?.args?.blockAddress as `0x${string}`;
          break;
        }
      } catch {
        // ignore non-matching logs
      }
    }

    if (!blockAddress) {
      throw new Error('No se pudo obtener la dirección del bloque creado');
    }

    return { blockAddress, txHash: hash };
  };

  const handleAdvance = async () => {
    if (!account || !distribution || !nextLevelId || !nextLevelName || !contractAddress) {
      toast.error("Datos incompletos para avanzar");
      return;
    }

    setAction("advance");
    setIsProcessing(true);
    const toastId = toast.loading("Procesando avance al siguiente nivel...");

    try {
      console.log('Starting advance flow with PayoutModule:', {
        advanceContribution: distribution.advanceContribution,
        advanceCommission: distribution.advanceCommission,
        advanceToWallet: distribution.advanceToWallet,
        totalEarnings,
        nextLevelId,
        contractAddress,
        payoutModuleAddress: CONTRACTS.PAYOUT_MODULE,
      });

      // Guardrail: validate ownership using walletAddress prop
      if (onchainOwner && onchainOwner.toLowerCase() !== account.toLowerCase()) {
        throw new Error(
          `Este bloque pertenece a otra wallet (${onchainOwner.slice(0, 6)}...${onchainOwner.slice(-4)}). ` +
          `Conecta esa wallet en Reown para poder avanzar.`
        );
      }

      // STEP 1: Call PayoutModule.advance() which does EVERYTHING:
      // - Transfers 10% of costNext to SocCoop wallet
      // - Finds and pays TOP block creator (90% of costNext)
      // - Transfers payout to user
      // - Advances userLevel on Registry
      // - Creates the next level block automatically
      toast.loading("Paso 1/2: Ejecutando avance on-chain...", { id: toastId });
      // center = on-chain owner of the block (from DB or contract)
      // This MUST match the block's center/owner on-chain
      const centerAddress = onchainOwner || account;
      
      console.log('Calling PayoutModule.advance():', { 
        blockAddr: contractAddress, 
        center: centerAddress, 
        payoutTo: account 
      });
      
      let newBlockAddress: string;
      let advanceTxHash: string;
      try {
        const hash = await writeContractAsync({
          address: CONTRACTS.PAYOUT_MODULE as `0x${string}`,
          abi: PAYOUT_MODULE_ABI,
          functionName: 'advance',
          args: [
            contractAddress as `0x${string}`,
            centerAddress as `0x${string}`, // center = block owner
            account as `0x${string}`, // payoutTo = user's wallet (can be same or different)
          ],
          account,
          chain,
          gas: BigInt(5_000_000),
        });
        advanceTxHash = hash;
        
        toast.loading("Confirmando transacción on-chain...", { id: toastId });
        
        if (!publicClient) throw new Error('Cliente público no disponible');
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        
        if (receipt.status !== 'success') {
          throw new Error('La transacción de avance falló on-chain');
        }
        
        toast.loading("Transacción confirmada. Procesando resultado...", { id: toastId });
        
        // Extract nextBlock address from AdvanceExecuted event
        let foundNextBlock: string | null = null;
        for (const log of receipt.logs as any[]) {
          if (!log?.address) continue;
          if (String(log.address).toLowerCase() !== String(CONTRACTS.PAYOUT_MODULE).toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({
              abi: PAYOUT_MODULE_ABI as any,
              data: log.data,
              topics: log.topics,
            }) as any;
            if (decoded?.eventName === 'AdvanceExecuted') {
              foundNextBlock = decoded?.args?.nextBlock as string;
              console.log('AdvanceExecuted event:', decoded.args);
              break;
            }
          } catch {
            // ignore non-matching logs
          }
        }
        
        // If not found in PayoutModule events, check Registry for MyBlockCreated
        if (!foundNextBlock) {
          for (const log of receipt.logs as any[]) {
            if (!log?.address) continue;
            if (String(log.address).toLowerCase() !== String(CONTRACTS.REGISTRY).toLowerCase()) continue;
            try {
              const decoded = decodeEventLog({
                abi: REGISTRY_ABI as any,
                data: log.data,
                topics: log.topics,
              }) as any;
              if (decoded?.eventName === 'MyBlockCreated') {
                foundNextBlock = decoded?.args?.blockAddress as string;
                console.log('MyBlockCreated event:', decoded.args);
                break;
              }
            } catch {
              // ignore non-matching logs
            }
          }
        }
        
        if (!foundNextBlock) {
          throw new Error('No se pudo obtener la dirección del nuevo bloque');
        }
        
        newBlockAddress = foundNextBlock;
        console.log('Advance completed:', { newBlockAddress, advanceTxHash });
      } catch (advanceError: any) {
        console.error('Advance failed:', advanceError);
        const errMsg = advanceError?.shortMessage || advanceError?.message || 'Error desconocido';
        throw new Error(`Error en el avance on-chain: ${errMsg}`);
      }

      // STEP 1.5: Join the TOP block at the next level
      // PayoutModule.advance() pays the TOP block creator but does NOT join the user.
      // We must call registry.joinTargetBlock() separately.
      let topBlockInfo: { creatorAddress: string; contractAddress: string } | null = null;
      
      if (nextLevelId && publicClient) {
        toast.loading("Verificando asignación a bloque TOP...", { id: toastId });
        
        try {
          // Query on-chain for the TOP block at the next level
          const [topBlock, topBlockCreator] = await (publicClient as any).readContract({
            address: CONTRACTS.REGISTRY as `0x${string}`,
            abi: REGISTRY_ABI,
            functionName: 'findTopBlockAtLevel',
            args: [BigInt(nextLevelId)],
          }) as [string, string];
          
          const zeroAddr = '0x0000000000000000000000000000000000000000';
          
          if (topBlock && topBlock !== zeroAddr && topBlockCreator !== zeroAddr && topBlockCreator.toLowerCase() !== account.toLowerCase()) {
            console.log('TOP block found on-chain:', { topBlock, topBlockCreator });
            topBlockInfo = { creatorAddress: topBlockCreator, contractAddress: topBlock };
            
            // Join the advancing user to the TOP block on-chain
            toast.loading("Uniéndote al bloque TOP del siguiente nivel...", { id: toastId });
            try {
              const joinHash = await writeContractAsync({
                address: CONTRACTS.REGISTRY as `0x${string}`,
                abi: REGISTRY_ABI,
                functionName: 'joinTargetBlock',
                args: [account as `0x${string}`, topBlock as `0x${string}`],
                account,
                chain,
                gas: BigInt(5_000_000),
              });
              
              await waitForTx(joinHash);
              console.log('Successfully joined TOP block:', topBlock, 'tx:', joinHash);
            } catch (joinErr: any) {
              // Don't fail the whole advance if join fails (payment already done)
              console.warn('Failed to join TOP block (payment was already sent):', joinErr?.shortMessage || joinErr?.message);
            }
          } else {
            // No TOP block available - funds stay in Treasury
            console.log('No TOP block available at level', nextLevelId);
          }
        } catch (topErr: any) {
          console.warn('Error finding/joining TOP block:', topErr?.message);
        }
      }

      // On-chain advance is complete - no DB sync needed (100% on-chain architecture)
      console.log('Advance completed on-chain:', { newBlockAddress, advanceTxHash });

      // NOTE: TOP block contribution is tracked but NOT paid here (handled on-chain by PayoutModule)
      // The topBlockInfo is just for logging/tracking purposes
      if (topBlockInfo) {
        console.log('User assigned to TOP block:', topBlockInfo.contractAddress);
      }

      // Success notification
      const successMsg = topBlockInfo 
        ? `¡Avanzaste al ${nextLevelName}! Recibiste ${distribution.advanceToWallet.toFixed(2)} USDT y te uniste a un bloque TOP.`
        : `¡Avanzaste al ${nextLevelName}! Recibiste ${distribution.advanceToWallet.toFixed(2)} USDT.`;
      toast.success(successMsg, { id: toastId });
      console.log('Advance flow completed successfully');
      setIsProcessing(false);
      setAction(null);
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Advance level error:', error);
      toast.error(error.message || "Error al avanzar de nivel", { id: toastId });
      setIsProcessing(false);
      setAction(null);
    }
  };

  const handleWithdraw = async () => {
    if (!account || !contractAddress) {
      toast.error("Conecta tu billetera primero");
      return;
    }

    setAction("withdraw");
    setIsProcessing(true);
    const toastId = toast.loading("Procesando retiro on-chain...");

    try {
      // Validate ownership using walletAddress prop
      if (onchainOwner && onchainOwner.toLowerCase() !== account.toLowerCase()) {
        throw new Error(
          `Este bloque pertenece a otra wallet (${onchainOwner.slice(0, 6)}...${onchainOwner.slice(-4)}). ` +
          `Conecta esa wallet en Reown para poder retirar.`
        );
      }

      // Call PayoutModule.cashout() directly on-chain
      toast.loading("Ejecutando cashout on-chain...", { id: toastId });
      const centerAddress = onchainOwner || account;
      
      const hash = await writeContractAsync({
        address: CONTRACTS.PAYOUT_MODULE as `0x${string}`,
        abi: PAYOUT_MODULE_ABI,
        functionName: 'cashout',
        args: [
          contractAddress as `0x${string}`,
          centerAddress as `0x${string}`,
          account as `0x${string}`,
        ],
        account,
        chain,
        gas: BigInt(5_000_000),
      });

      if (!publicClient) throw new Error('Cliente público no disponible');
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      
      if (receipt.status !== 'success') {
        throw new Error('La transacción de retiro falló on-chain');
      }

      const netWithdraw = (totalEarnings * 0.9).toFixed(2);
      toast.success(`¡Retiro completado! Recibiste ${netWithdraw} USDT.`, { id: toastId });
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Withdraw error:', error);
      const errMsg = error?.shortMessage || error?.message || "Error al retirar";
      toast.error(errMsg, { id: toastId });
    } finally {
      setIsProcessing(false);
      setAction(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => !isProcessing && onClose()}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <Gift className="w-6 h-6 text-success" />
            ¡Bloque Completado!
          </DialogTitle>
          <DialogDescription>
            Tu bloque del nivel {currentLevelName} se ha completado. Elige tu siguiente paso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Ownership Mismatch Warning */}
          {ownershipMismatch && onchainOwner && (
            <Card className="p-4 bg-destructive/10 border-destructive/50">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="font-semibold text-destructive">Wallet incorrecta conectada</p>
                  <p className="text-sm text-muted-foreground">
                    Este bloque pertenece a la wallet:
                  </p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                    {onchainOwner}
                  </code>
                  <p className="text-sm text-muted-foreground mt-2">
                    Abre Reown y cambia a esa wallet para poder retirar o avanzar.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Earnings Summary - show net amount (after 10% commission) */}
          <Card className="p-4 bg-success/10 border-success/30">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Recaudado neto</span>
              <span className="text-2xl font-bold text-success">{(totalEarnings * 0.9).toFixed(2)} USDT</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Bruto: {totalEarnings.toFixed(2)} USDT − Comisión 10%: {(totalEarnings * 0.1).toFixed(2)} USDT
            </p>
          </Card>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Option 1: Advance to next level */}
              {hasNextLevel && distribution && (
                <Card 
                  className={`p-4 cursor-pointer transition-all border-2 ${
                    action === "advance" 
                      ? "border-primary bg-primary/5" 
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => !isProcessing && setAction("advance")}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-primary/20 rounded-full">
                      <TrendingUp className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold flex items-center gap-2">
                        {isLastLevel ? "Unirse a Sociedad Cooperativa" : `Avanzar al ${nextLevelName}`}
                        <ArrowRight className="w-4 h-4" />
                      </h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Dispersión de tus {(totalEarnings * 0.9).toFixed(2)} USDT netos:
                      </p>
                      <div className="mt-2 space-y-1 p-2 bg-muted/50 rounded-lg text-sm">
                        <div className="flex justify-between">
                          <span>Aporte {isLastLevel ? "Sociedad" : `al ${nextLevelName}`}:</span>
                          <span className="font-bold text-primary">{distribution.advanceContribution.toFixed(2)} USDT</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Comisión plataforma (10%):</span>
                          <span className="font-bold text-warning">{distribution.advanceCommission.toFixed(2)} USDT</span>
                        </div>
                        <div className="flex justify-between border-t border-border pt-1 mt-1">
                          <span className="font-medium">Recibirás:</span>
                          <span className="font-bold text-success">{distribution.advanceToWallet.toFixed(2)} USDT</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Option 2: Withdraw and exit */}
              <Card 
                className={`p-4 cursor-pointer transition-all border-2 ${
                  action === "withdraw" 
                    ? "border-warning bg-warning/5" 
                    : "border-border hover:border-warning/50"
                }`}
                onClick={() => !isProcessing && setAction("withdraw")}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-warning/20 rounded-full">
                    <LogOut className="w-5 h-5 text-warning" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold">Retirar y salir</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Recibe tus ganancias netas y cierra tu participación en este nivel
                    </p>
                    <div className="mt-2 space-y-1 p-2 bg-muted/50 rounded-lg text-sm">
                      <div className="flex justify-between">
                        <span>Aportes brutos:</span>
                        <span className="font-bold">{totalEarnings.toFixed(2)} USDT</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Comisión plataforma (10%):</span>
                        <span className="font-bold text-warning">-{(totalEarnings * 0.1).toFixed(2)} USDT</span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1 mt-1">
                        <span className="font-medium">Recibirás:</span>
                        <span className="font-bold text-success">{(totalEarnings * 0.9).toFixed(2)} USDT</span>
                      </div>
                    </div>
                    {hasNextLevel && (
                      <div className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
                        <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>No avanzarás al siguiente nivel</span>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </>
          )}

          {/* Connected Wallet Info */}
          {account && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-2">
              <Wallet className="w-4 h-4" />
              <span>Wallet: {account.slice(0, 6)}...{account.slice(-4)}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={isProcessing}
            >
              Decidir después
            </Button>
            <Button
              className="flex-1"
              onClick={action === "advance" ? handleAdvance : handleWithdraw}
              disabled={isProcessing || !action || !account || isLoading || ownershipMismatch}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : ownershipMismatch ? (
                "Cambia wallet en Reown"
              ) : action === "advance" ? (
                isLastLevel ? "Unirme a Sociedad" : "Avanzar nivel"
              ) : action === "withdraw" ? (
                "Retirar todo"
              ) : (
                "Selecciona opción"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
