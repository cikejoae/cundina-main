import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Users, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatUnits, parseAbi, parseUnits } from "viem";
import { CONTRACTS, USDT_TOKEN_ADDRESS } from "@/config/contracts";
import { useSearchParams } from "react-router-dom";
import { sepolia } from "@reown/appkit/networks";
import { resolveReferralCode as resolveReferralCodeOnChain } from "@/lib/contractReads";

const SEPOLIA_CHAIN_ID = 11155111;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

interface JoinBlockCardProps {
  userId: string;
  walletAddress: string | null;
  onJoinSuccess: () => void;
}

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 value) returns (bool)',
]);

const BLOCK_ABI = parseAbi(['function joinBlock()']);

// Block ABI for new EOA Treasury architecture (CundinaBlockSecure clones)
// Used for preflight validation (capacity/status/registry-compatibility) before submitting join tx.
const BLOCK_INFO_ABI = parseAbi([
  'function registry() external view returns (address)',
  'function levelId() external view returns (uint256)',
  'function requiredMembers() external view returns (uint256)',
  // Some revisions expose membersCount(); others only expose getMembers().
  'function membersCount() external view returns (uint256)',
  'function getMembers() external view returns (address[] memory)',
  'function contributionAmount() external view returns (uint256)',
  'function status() external view returns (uint8)',
  'function owner() external view returns (address)',
]);

// Registry ABI for V5 architecture
// NOTE: joinLevel1 in V5 only takes (member) — target block auto-resolved from referrer
const REGISTRY_ABI = parseAbi([
  'function registerUser(address user, address referrer, uint256 level) external',
  'function registerAndCreateBlock(address user, address referrer, uint256 level) external returns (address)',
  'function createMyBlock(address center) external returns (address)',
  'function joinLevel1(address member) external',
  'function joinTargetBlock(address member, address targetBlock) external',
  'function userLevel(address user) external view returns (uint256)',
  'function myBlockAtLevel(address user, uint256 level) external view returns (address)',
  'function registrationFee(uint256 level) external view returns (uint256)',
  'function referrerOf(address user) external view returns (address)',
  'event UserRegistered(address indexed user, address indexed referrer, uint256 level)',
  'event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress)',
  'event MemberJoined(address indexed member, uint256 indexed position, uint256 amount)',
]);

// PayoutModule ABI for PI dispersion (10% of registration fee)
const PAYOUT_MODULE_ABI = parseAbi([
  'function disperseRegistrationFee(address user, uint256 level) external',
]);

export const JoinBlockCard = ({ userId, walletAddress, onJoinSuccess }: JoinBlockCardProps) => {
  const { address: account, isConnected, chain } = useAccount();
  const activeChain = (chain ?? (sepolia as any)) as any;
  // NOTE: We prefer a fixed public client to avoid edge cases where `chain` is undefined.
  // If the user is connected to another chain, the write will still fail clearly in the wallet.
  const publicClient = usePublicClient({ chainId: chain?.id ?? SEPOLIA_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [searchParams] = useSearchParams();

  const registryAddress = CONTRACTS.REGISTRY;

  const { data: tokenDecimals } = useReadContract({
    address: USDT_TOKEN_ADDRESS,
    abi: ERC20_ABI as any,
    functionName: 'decimals',
    chainId: chain?.id,
    query: { enabled: true },
  });

  const decimals = typeof tokenDecimals === 'number' ? tokenDecimals : 18;

  const { data: tokenBalance, refetch: refetchBalance } = useReadContract({
    address: USDT_TOKEN_ADDRESS,
    abi: ERC20_ABI as any,
    functionName: 'balanceOf',
    args: account ? [account as `0x${string}`] : undefined,
    chainId: chain?.id,
    query: { enabled: !!account },
  });

  const balance = tokenBalance ? Number(formatUnits(tokenBalance as bigint, decimals)).toFixed(2) : "0";

  const [isProcessing, setIsProcessing] = useState(false);
  const [referralInput, setReferralInput] = useState("");

  // Auto-fill referral code from URL or localStorage
  useEffect(() => {
    const urlRef = searchParams.get('ref');
    const storedRef = localStorage.getItem('referralCode');
    const codeToUse = urlRef || storedRef;
    if (codeToUse && !referralInput) {
      setReferralInput(codeToUse.toUpperCase());
    }
  }, [searchParams]);

  const getViemErrorMessage = (err: unknown) => {
    const e = err as any;
    return (
      e?.shortMessage ||
      e?.cause?.shortMessage ||
      e?.details ||
      e?.cause?.details ||
      e?.message ||
      'Error desconocido'
    );
  };

  const withTimeout = async <T,>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> => {
    let timeoutId: number | undefined;
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), ms);
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  };

  const waitForTx = async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error('Cliente público no disponible');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // CRITICAL: Verify transaction was successful (status = 1)
    if (receipt.status !== 'success') {
      throw new Error('La transacción falló en blockchain. No se realizaron cambios.');
    }
    return receipt;
  };

  const approveToken = async (spender: `0x${string}`, amount: string | bigint) => {
    const value = typeof amount === 'bigint' ? amount : parseUnits(amount, decimals);
    const hash = await writeContractAsync({
      address: USDT_TOKEN_ADDRESS,
      abi: ERC20_ABI as any,
      functionName: 'approve',
      args: [spender, value],
      account: account as `0x${string}`,
      chain: chain as any,
    });
    await waitForTx(hash);
    return hash;
  };

  const getRegistrationFeeWei = async (levelId: number): Promise<bigint> => {
    if (!publicClient) throw new Error('Cliente público no disponible');
    try {
      const fee = await (publicClient as any).readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'registrationFee',
        args: [BigInt(levelId)],
      });
      return BigInt(fee || 0);
    } catch (err) {
      // Fallback: if this function isn't available (or RPC hiccup), assume L1 registration fee = 20.
      // This prevents a common failure mode where registerUser() pulls tokens but user approved only the join amount.
      console.warn('[JoinBlockCard] registrationFee() not available, using fallback', err);
      return levelId === 1 ? parseUnits('20', decimals) : 0n;
    }
  };

  const getTokenBalanceWei = async (): Promise<bigint> => {
    if (!publicClient || !account) return 0n;
    try {
      const bal = await (publicClient as any).readContract({
        address: USDT_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account as `0x${string}`],
      });
      return BigInt(bal || 0);
    } catch (err) {
      console.warn('[JoinBlockCard] getTokenBalanceWei failed, defaulting to 0', err);
      return 0n;
    }
  };

  // Check if a user (self or referrer) is registered on-chain
  const checkUserLevel = async (userAddress?: `0x${string}`): Promise<bigint> => {
    const target = userAddress || account;
    if (!publicClient || !target) return BigInt(0);
    try {
      const result = await (publicClient as any).readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'userLevel',
        args: [target],
      });
      console.log(`[JoinBlockCard] userLevel(${target}) =`, result?.toString());
      return BigInt(result || 0);
    } catch (err) {
      console.error('[JoinBlockCard] checkUserLevel error:', err);
      return BigInt(0);
    }
  };

  const readBlockSnapshot = async (blockAddress: `0x${string}`) => {
    if (!publicClient) return null;
    try {
      const [registry, levelId, requiredMembers, contributionAmount, status, owner] = await Promise.all([
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: 'registry',
        }),
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: 'levelId',
        }),
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: 'requiredMembers',
        }),
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: 'contributionAmount',
        }),
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: 'status',
        }),
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: 'owner',
        }),
      ]);

      // membersCount is not universally implemented; fallback to getMembers().length
      let membersCount = 0n;
      try {
        const mc = await (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: 'membersCount',
        });
        membersCount = BigInt(mc ?? 0);
      } catch {
        try {
          const members = await (publicClient as any).readContract({
            address: blockAddress,
            abi: BLOCK_INFO_ABI,
            functionName: 'getMembers',
          });
          membersCount = BigInt(Array.isArray(members) ? members.length : 0);
        } catch {
          membersCount = 0n;
        }
      }

      return {
        registry: String(registry ?? '') as `0x${string}`,
        levelId: BigInt(levelId ?? 0),
        requiredMembers: BigInt(requiredMembers ?? 0),
        membersCount: BigInt(membersCount ?? 0),
        contributionAmount: BigInt(contributionAmount ?? 0),
        status: BigInt(status ?? 0),
        owner: String(owner ?? '') as `0x${string}`,
      };
    } catch (err) {
      // Not all blocks may implement this (legacy), so treat as optional.
      console.warn('[JoinBlockCard] readBlockSnapshot failed:', err);
      return null;
    }
  };

  // Register user on-chain (required before joinLevel1 for new users)
  // NOTE: Registration is now handled by registerAndCreateBlock in PaymentCard for block creators.
  // For members joining a L1 block, joinLevel1 requires userLevel == 1.
  // So we must register them explicitly at level 1.
  const registerUserOnChain = async (
    referrerAddress: `0x${string}` = '0x0000000000000000000000000000000000000000' as `0x${string}`,
    level: number = 1
  ): Promise<string> => {
    console.log('[JoinBlockCard] registerUserOnChain called with referrer:', referrerAddress, 'level:', level);
    
    // CRITICAL: Check if referrer is registered on-chain (level >= 1)
    // If referrer is not registered, the contract will revert
    if (referrerAddress !== '0x0000000000000000000000000000000000000000') {
      const referrerLevel = await checkUserLevel(referrerAddress);
      if (referrerLevel === BigInt(0)) {
        throw new Error(
          `El referido (${referrerAddress.slice(0, 8)}...) no está registrado on-chain. ` +
          `Debe crear su bloque primero antes de poder referir a otros usuarios.`
        );
      }
      console.log('[JoinBlockCard] Referrer is registered on-chain, level:', referrerLevel.toString());
    }
    
    // registerUser(user, referrer, level)
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: 'registerUser',
      args: [account as `0x${string}`, referrerAddress, BigInt(level)],
      account: account as `0x${string}`,
      chain: chain as any,
      gas: BigInt(500_000),
    });
    await waitForTx(txHash);
    console.log('[JoinBlockCard] registerUserOnChain success, txHash:', txHash);
    return txHash;
  };

  const joinBlockOnChain = async (blockAddress: string, joinAmount: string, referrerWallet?: string, levelId: number = 1): Promise<{ txHash: string; myBlockAddress: string | null }> => {
    const chainId = chain?.id ?? SEPOLIA_CHAIN_ID;

    // PRE-FLIGHT (on-chain): validate block status/capacity and pull exact contribution amount.
    const snapshot = await readBlockSnapshot(blockAddress as `0x${string}`);
    if (snapshot) {
      // CRITICAL: Prevent joining blocks from an older/other Registry deployment.
      // This is the #1 cause of the on-chain revert "Only registry".
      const snapRegistry = String(snapshot.registry || '').toLowerCase();
      if (snapRegistry && snapRegistry !== registryAddress.toLowerCase()) {
        throw new Error(
          `Este bloque pertenece a otro contrato Registry (${snapRegistry.slice(0, 10)}...). ` +
          `No es compatible con el Registry actual.`
        );
      }

      // Only L1 blocks are joinable via joinLevel1
      if (snapshot.levelId !== 1n) {
        throw new Error('Este bloque no es de Nivel 1 en blockchain.');
      }

      // status: 0 = Active, 1 = Completed (matches blockchain-sync)
      if (snapshot.status !== 0n) {
        throw new Error('Este bloque ya está completado en blockchain y no acepta más miembros.');
      }

      // If the contract is already at/over capacity, joinLevel1 will revert.
      if (snapshot.requiredMembers > 0n && snapshot.membersCount >= snapshot.requiredMembers) {
        throw new Error(
          `Este bloque ya no tiene cupos en blockchain (${snapshot.membersCount.toString()}/${snapshot.requiredMembers.toString()} miembros registrados).`
        );
      }
    }

    // STEP 1: Check if user is registered on-chain first
    const currentLevel = await checkUserLevel();
    
    // CRITICAL: For Level 1 blocks, the contract requires userLevel == 1.
    // If user has a higher level, they cannot join L1 blocks anymore.
    if (levelId === 1 && currentLevel > 1n) {
      throw new Error(
        `Tu nivel on-chain es ${currentLevel.toString()}. No puedes unirte a bloques de Nivel 1 porque ya avanzaste. ` +
        `Solo puedes unirte a bloques de tu nivel actual o superior.`
      );
    }
    
    const referrerAddress = referrerWallet
      ? (referrerWallet as `0x${string}`)
      : (ZERO_ADDRESS as `0x${string}`);

    // Check if user is already a member of THIS specific target block
    if (publicClient && account) {
      console.log('[JoinBlockCard] Checking if user is already member of target block...');
      try {
        const members = await (publicClient as any).readContract({
          address: blockAddress as `0x${string}`,
          abi: BLOCK_INFO_ABI,
          functionName: 'getMembers',
        });
        const membersList = Array.isArray(members)
          ? members.map((m: string) => m.toLowerCase())
          : [];
        if (membersList.includes(account.toLowerCase())) {
          throw new Error(
            'Ya eres miembro de este bloque. No puedes unirte de nuevo.'
          );
        }
      } catch (err: any) {
        if (err.message?.includes('Ya eres miembro')) throw err;
        console.warn('[JoinBlockCard] getMembers check failed (non-critical):', err);
      }
    }

    // IMPORTANT: joinBlock is FREE. Only registration costs 20 USDT.
    // - registerUser() pulls the REGISTRATION FEE from the user (spender = REGISTRY)
    // - joinLevel1() does NOT pull any tokens (0 cost)
    const needsRegistration = currentLevel === 0n;
    const registrationFeeWei = needsRegistration ? await getRegistrationFeeWei(levelId) : 0n;

    // Preflight: ensure user actually has enough balance for registration only.
    if (needsRegistration) {
      const balanceWei = await getTokenBalanceWei();
      if (balanceWei < registrationFeeWei) {
        const needed = Number(formatUnits(registrationFeeWei, decimals)).toFixed(2);
        throw new Error(`Balance insuficiente. Necesitas ${needed} USDT para el registro.`);
      }
    }

    const ensureAllowance = async (spender: `0x${string}`, neededWei: bigint, label: string) => {
      if (neededWei <= 0n) return;
      if (!publicClient || !account) {
        toast.loading(label, { id: 'join-toast' });
        await approveToken(spender, neededWei);
        return;
      }
      try {
        const allowance = await (publicClient as any).readContract({
          address: USDT_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [account as `0x${string}`, spender],
        });
        const allowanceWei = BigInt(allowance || 0);
        console.log('[JoinBlockCard] allowance', { spender, allowanceWei: allowanceWei.toString(), neededWei: neededWei.toString() });
        if (allowanceWei < neededWei) {
          toast.loading(label, { id: 'join-toast' });
          await approveToken(spender, neededWei);
        }
      } catch (err) {
        // If read fails, fallback to approving to avoid false negatives.
        console.warn('[JoinBlockCard] allowance read failed, approving defensively:', err);
        toast.loading(label, { id: 'join-toast' });
        await approveToken(spender, neededWei);
      }
    };

    // STEP 2: If needed, approve REGISTRY for the registration fee and register.
    if (needsRegistration) {
      await ensureAllowance(registryAddress as `0x${string}`, registrationFeeWei, 'Aprobando registro...');
      toast.loading('Registrando usuario on-chain...', { id: 'join-toast' });
      await registerUserOnChain(referrerAddress, levelId);
    }

    // STEP 3: joinLevel1 is FREE - no additional approval needed for the block contract
    // The join contribution is handled entirely by the registration fee.

    // STEP 4: Call joinLevel1 through the Registry (this will also create the member's personal block)
    // CRITICAL: Use the constant REGISTRY address to ensure we ALWAYS call the Registry, not the block
    const REGISTRY_ADDRESS_CONSTANT = CONTRACTS.REGISTRY as `0x${string}`;
    
    console.log('[JoinBlockCard] Preparing joinLevel1 (V5 — member only):', {
      registry: REGISTRY_ADDRESS_CONSTANT,
      member: account,
    });

    toast.loading('Uniéndose al bloque...', { id: 'join-toast' });

    // V5: joinLevel1(member) — target block auto-resolved from referrer's L1 block
    const txHash = await writeContractAsync({
      address: REGISTRY_ADDRESS_CONSTANT,
      abi: REGISTRY_ABI as any,
      functionName: 'joinLevel1',
      args: [account as `0x${string}`],
      account: account as `0x${string}`,
      chain: activeChain,
      gas: BigInt(5_000_000),
    });

    console.log('[JoinBlockCard] joinLevel1 tx submitted:', txHash);
    toast.loading('Confirmando transacción...', { id: 'join-toast' });
    
    if (!publicClient) throw new Error('Cliente público no disponible');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
    
    if (receipt.status !== 'success') {
      throw new Error('La transacción falló en blockchain');
    }
    
    console.log('[JoinBlockCard] joinLevel1 confirmed, extracting events...');
    
    // STEP 5: Extract the member's new block address from MyBlockCreated event
    let myBlockAddress: string | null = null;
    const { decodeEventLog } = await import('viem');
    
    for (const log of receipt.logs as any[]) {
      if (log.address.toLowerCase() !== REGISTRY_ADDRESS_CONSTANT.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: REGISTRY_ABI as any,
          data: log.data,
          topics: log.topics,
        }) as any;
        if (decoded?.eventName === 'MyBlockCreated' && decoded?.args?.center?.toLowerCase() === account?.toLowerCase()) {
          myBlockAddress = decoded?.args?.blockAddress as string;
          console.log('[JoinBlockCard] Found MyBlockCreated event, member block:', myBlockAddress);
          break;
        }
      } catch {
        // ignore non-matching logs
      }
    }
    
    // STEP 6: If MyBlockCreated was NOT found (old contract), create block manually
    // CRITICAL: Only attempt createMyBlock if user doesn't already have a block at this level
    // This prevents "already has block" errors when joinLevel1 already created the block
    // or when the user used registerAndCreateBlock flow previously
    if (!myBlockAddress) {
      console.log('[JoinBlockCard] MyBlockCreated not found in joinLevel1 logs, checking if user already has block...');
      
      // Check on-chain if user already has a block at this level
      const existingBlockOnChain = await (publicClient as any).readContract({
        address: CONTRACTS.REGISTRY as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: 'myBlockAtLevel',
        args: [account as `0x${string}`, BigInt(levelId)],
      });
      
      const existingBlockAddr = String(existingBlockOnChain || '').toLowerCase();
      
      if (existingBlockAddr && existingBlockAddr !== ZERO_ADDRESS) {
        // User already has a block - use that instead of creating a new one
        myBlockAddress = existingBlockAddr;
        console.log('[JoinBlockCard] User already has block on-chain:', myBlockAddress);
      } else {
        // User truly doesn't have a block - this is a legacy contract scenario
        console.log('[JoinBlockCard] No block found, creating via createMyBlock...');
        toast.loading('Creando tu bloque personal...', { id: 'join-toast' });
        
        const createTxHash = await writeContractAsync({
          address: REGISTRY_ADDRESS_CONSTANT,
          abi: REGISTRY_ABI as any,
          functionName: 'createMyBlock',
          args: [account as `0x${string}`],
          account: account as `0x${string}`,
          chain: activeChain,
          gas: BigInt(5_000_000),
        });
        
        const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash, timeout: 180_000 });
        
        if (createReceipt.status !== 'success') {
          throw new Error('No se pudo crear tu bloque personal');
        }
        
        // Extract address from this receipt
        for (const log of createReceipt.logs as any[]) {
          if (log.address.toLowerCase() !== REGISTRY_ADDRESS_CONSTANT.toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({
              abi: REGISTRY_ABI as any,
              data: log.data,
              topics: log.topics,
            }) as any;
            if (decoded?.eventName === 'MyBlockCreated') {
              myBlockAddress = decoded?.args?.blockAddress as string;
              console.log('[JoinBlockCard] Created block via createMyBlock:', myBlockAddress);
              break;
            }
          } catch {
            // ignore
          }
        }
      }
    }
    
    // STEP 7: Disperse registration fee (10% to SocCoop) via PayoutModule
    // This is a best-effort call - the join already succeeded on-chain
    // Use a shorter timeout and handle network issues gracefully
    const disperseToastId = toast.loading('Dispersando comisión SocCoop (10%)...', { id: 'disperse-toast' });
    try {
      console.log('[JoinBlockCard] Calling disperseRegistrationFee for user:', account, 'level:', levelId);
      
      const disperseTxHash = await writeContractAsync({
        address: CONTRACTS.PAYOUT_MODULE as `0x${string}`,
        abi: PAYOUT_MODULE_ABI as any,
        functionName: 'disperseRegistrationFee',
        args: [account as `0x${string}`, BigInt(levelId)],
        account: account as `0x${string}`,
        chain: activeChain,
        gas: BigInt(200_000),
      });
      
      console.log('[JoinBlockCard] disperseRegistrationFee tx sent:', disperseTxHash);
      toast.loading('Confirmando dispersión SocCoop...', { id: disperseToastId });
      
      // Use withTimeout to prevent hanging on network issues
      // Sepolia RPC can be flaky - 60s is enough for most confirmations
      try {
        const disperseReceipt = await withTimeout(
          publicClient.waitForTransactionReceipt({ hash: disperseTxHash, timeout: 60_000 }),
          65_000,
          'Timeout esperando confirmación de dispersión SocCoop'
        );
        if (disperseReceipt.status === 'success') {
          console.log('[JoinBlockCard] disperseRegistrationFee confirmed:', disperseTxHash);
          toast.success('Dispersión SocCoop completada', { id: disperseToastId });
        } else {
          console.warn('[JoinBlockCard] disperseRegistrationFee failed on-chain');
          toast.dismiss(disperseToastId);
        }
      } catch (receiptErr) {
        // Transaction was sent but confirmation timed out
        // The tx likely succeeded - user can verify on etherscan
        console.warn('[JoinBlockCard] disperseRegistrationFee confirmation timeout, tx may have succeeded:', disperseTxHash, receiptErr);
        toast.dismiss(disperseToastId);
      }
    } catch (err) {
      // Log but don't fail the join flow - the on-chain join already succeeded
      console.warn('[JoinBlockCard] disperseRegistrationFee call failed:', err);
      toast.dismiss(disperseToastId);
    }
    
    return { txHash, myBlockAddress };
  };

  const createBlockOnChain = async (newLevelId: number): Promise<{ blockAddress: string; txHash: string }> => {
    const chainId = chain?.id ?? SEPOLIA_CHAIN_ID;
    // Using new Registry: createMyBlock(center)
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: 'createMyBlock',
      args: [account as `0x${string}`],
      account: account as `0x${string}`,
      chain: activeChain,
    });

    if (!publicClient) throw new Error('Cliente público no disponible');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    let blockAddress: `0x${string}` | null = null;
    for (const log of receipt.logs as any[]) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
      try {
        const { decodeEventLog } = await import('viem');
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

    return { blockAddress, txHash };
  };

  const handleJoinBlock = async () => {
    if (!account) {
      toast.error("Conecta tu billetera primero");
      return;
    }

    if (!referralInput.trim()) {
      toast.error("Ingresa un código de referido o dirección de wallet");
      return;
    }

    const balanceNum = parseFloat(balance);
    if (balanceNum < 20) {
      toast.error("Balance insuficiente. Necesitas 20 USDT");
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading("Buscando bloque...");

    try {
      // Use wallet address directly instead of UUID
      const activeWalletAddress = walletAddress || account?.toLowerCase() || null;
      
      if (!activeWalletAddress) {
        toast.error("No se detectó una wallet conectada", { id: toastId });
        setIsProcessing(false);
        return;
      }

      // PRE-CHECK: Prevent joining if user already has a Level 1 block on-chain
      if (publicClient && account) {
        try {
          const existingL1 = await (publicClient as any).readContract({
            address: CONTRACTS.REGISTRY as `0x${string}`,
            abi: REGISTRY_ABI,
            functionName: 'myBlockAtLevel',
            args: [account as `0x${string}`, 1n],
          });
          const existingL1Addr = String(existingL1 || '').toLowerCase();
          if (existingL1Addr && existingL1Addr !== ZERO_ADDRESS) {
            toast.dismiss(toastId);
            toast.error(
              `Ya tienes un bloque Nivel 1 on-chain (${existingL1Addr.slice(0, 10)}...). ` +
              `No puedes unirte a otro bloque L1. Invita miembros a tu bloque para avanzar.`
            );
            setIsProcessing(false);
            return;
          }
        } catch (err) {
          console.warn('[JoinBlockCard] Error checking existing L1 block:', err);
        }
      }

      // Resolve referrer wallet address
      const rawReferral = referralInput.trim();
      const referralCode = rawReferral.toUpperCase();
      localStorage.setItem('referralCode', referralCode);

      let referrerWalletAddress: `0x${string}`;

      // Accept a direct wallet address OR a referral code
      if (/^0x[a-fA-F0-9]{40}$/.test(rawReferral)) {
        referrerWalletAddress = rawReferral.toLowerCase() as `0x${string}`;
      } else {
      // Resolve referral code on-chain (V5 contract)
        toast.loading('Validando código de referido on-chain...', { id: toastId });
        
        if (!publicClient) {
          throw new Error('Cliente blockchain no disponible. Verifica tu conexión.');
        }
        
        const resolvedAddress = await resolveReferralCodeOnChain(publicClient, referralCode);
        
        if (!resolvedAddress) {
          // On-chain code not found
          throw new Error(
            'No se encontró ese código de referido on-chain. ' +
          'Verifica que el código sea correcto o usa la dirección de wallet completa (0x...).'
          );
        } else {
          referrerWalletAddress = resolvedAddress.toLowerCase() as `0x${string}`;
          console.log('[JoinBlockCard] Resolved referral code on-chain:', referralCode, '->', referrerWalletAddress);
        }
      }

      // NOTE: Referral chain is now tracked on-chain via Registry.referrerOf mapping
      // No need to update user_wallets.referred_by_wallet_id - this data comes from blockchain

      // ============================================================
      // CRITICAL: Determine flow based on REFERRER's on-chain level
      // - Referrer Level 1 → Join THEIR L1 block (registerUser + joinLevel1)
      // - Referrer Level 2+ → Create OWN block (registerAndCreateBlock), referrer gets ranking credit
      // ============================================================
      
      toast.loading('Verificando nivel del referidor...', { id: toastId });
      const referrerLevel = await checkUserLevel(referrerWalletAddress);
      console.log('[JoinBlockCard] Referrer level on-chain:', referrerLevel.toString());

      if (referrerLevel === 0n) {
        throw new Error(
          'El referidor no está registrado en blockchain. ' +
          'El referidor debe crear su propio bloque primero antes de poder invitar.'
        );
      }

      const amount = 20; // Level 1 contribution
      const levelId = 1;
      let txHash: string;
      let myBlockAddress: string | null = null;
      let joinedBlockAddress: string | null = null;
      let joinedBlockId: string | null = null;

      if (referrerLevel === 1n) {
        // ========================
        // FLOW A: Referrer is Level 1
        // → Find THEIR L1 block and join it
        // ========================
        toast.loading('Buscando bloque del referidor...', { id: toastId });

        // Get the referrer's L1 block address on-chain
        const referrerBlockAddr = await (publicClient as any).readContract({
          address: registryAddress,
          abi: REGISTRY_ABI,
          functionName: 'myBlockAtLevel',
          args: [referrerWalletAddress, 1n],
        });

        const referrerBlockAddress = String(referrerBlockAddr || '').toLowerCase();
        
        if (!referrerBlockAddress || referrerBlockAddress === ZERO_ADDRESS) {
          throw new Error(
            'El referidor no tiene un bloque Nivel 1. ' +
            'Pídele que cree su bloque primero usando el botón "Aporte 20 USDT".'
          );
        }

        // Validate the referrer's block is compatible and has capacity
        const snap = await readBlockSnapshot(referrerBlockAddress as `0x${string}`);
        if (!snap) {
          throw new Error('No se pudo leer el bloque del referidor en blockchain.');
        }

        // Check registry compatibility
        const snapRegistry = String(snap.registry || '').toLowerCase();
        if (snapRegistry !== registryAddress.toLowerCase()) {
          throw new Error(
            `El bloque del referidor pertenece a un Registry anterior (${snapRegistry.slice(0, 10)}...). ` +
            'No es compatible con el sistema actual.'
          );
        }

        // Check block is still active
        if (snap.status !== 0n) {
          throw new Error('El bloque del referidor ya está completado. No puedes unirte.');
        }

        // Check block has capacity
        if (snap.requiredMembers > 0n && snap.membersCount >= snap.requiredMembers) {
          throw new Error('El bloque del referidor está lleno. No hay cupos disponibles.');
        }

        joinedBlockAddress = referrerBlockAddress;
        joinedBlockId = null; // Block IDs are now contract addresses on-chain

        // Execute the join flow: registerUser + joinLevel1
        const result = await joinBlockOnChain(
          referrerBlockAddress,
          amount.toString(),
          referrerWalletAddress,
          levelId
        );
        
        txHash = result.txHash;
        myBlockAddress = result.myBlockAddress;

      } else {
        // ========================
        // FLOW B: Referrer is Level 2+
        // → Use registerAndCreateBlock to create invitee's OWN block
        // → Referrer just gets ranking credit (inviteSlots)
        // ========================
        toast.loading('Registrando y creando tu bloque...', { id: toastId });

        // Check if user already registered on-chain
        const myLevel = await checkUserLevel();
        
        let needsPayment = myLevel === 0n;
        const feeWei = await getRegistrationFeeWei(levelId);

        if (needsPayment) {
          // Check balance
          const balWei = await getTokenBalanceWei();
          if (balWei < feeWei) {
            throw new Error(`Balance insuficiente. Necesitas ${formatUnits(feeWei, decimals)} USDT.`);
          }

          // Approve tokens to Registry
          toast.loading('Aprobando tokens...', { id: toastId });
          const allowanceWei = await (publicClient as any).readContract({
            address: USDT_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [account as `0x${string}`, registryAddress as `0x${string}`],
          });

          if (BigInt(allowanceWei || 0) < feeWei) {
            await approveToken(registryAddress as `0x${string}`, feeWei);
          }
        }

        // Call registerAndCreateBlock
        toast.loading('Registrando en blockchain...', { id: toastId });
        const regTxHash = await writeContractAsync({
          address: registryAddress as `0x${string}`,
          abi: REGISTRY_ABI as any,
          functionName: 'registerAndCreateBlock',
          args: [
            account as `0x${string}`,
            referrerWalletAddress,
            BigInt(levelId),
          ],
          account: account as `0x${string}`,
          chain: activeChain,
          gas: BigInt(5_000_000),
        });

        toast.loading('Confirmando transacción...', { id: toastId });
        const receipt = await publicClient!.waitForTransactionReceipt({ hash: regTxHash, timeout: 180_000 });

        if (receipt.status !== 'success') {
          throw new Error('La transacción registerAndCreateBlock falló en blockchain.');
        }

        txHash = regTxHash;

        // Extract MyBlockCreated event to get the new block address
        const { decodeEventLog } = await import('viem');
        for (const log of receipt.logs as any[]) {
          if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({
              abi: REGISTRY_ABI as any,
              data: log.data,
              topics: log.topics,
            }) as any;
            if (decoded?.eventName === 'MyBlockCreated' && decoded?.args?.center?.toLowerCase() === account?.toLowerCase()) {
              myBlockAddress = decoded?.args?.blockAddress as string;
              console.log('[JoinBlockCard] Created block via registerAndCreateBlock:', myBlockAddress);
              break;
            }
          } catch {
            // ignore non-matching logs
          }
        }

        // For Flow B, the invitee creates their OWN block - there's no "joined" block
        joinedBlockAddress = null;
        joinedBlockId = null;
      }

      // ============================================================
      // Common post-transaction logic
      // ============================================================

      // NOTE: block_members sync removed - membership is now read directly from on-chain via subgraph
      // The InviteCountUpdated event is emitted on-chain during joinLevel1/registerAndCreateBlock
      // and will be indexed by the subgraph for ranking calculations

      // NOTE: Block registration, level progress, and transactions are now tracked
      // entirely on-chain and indexed by the Subgraph. No database sync needed.

      // NOTE: user_level_progress.block_id should point to the user's OWN personal block,
      // not the block they joined as a member. The correct linkage is already done above
      // in the "Register the member's personal block in the database" section (lines 1120-1130).
      // Previously, this section was overwriting block_id with joinedBlockId, causing the
      // user's progress to incorrectly point to the referrer's block instead of their own.

      // Create notification
      const notificationMessage = referrerLevel === 1n
        ? `Te has unido exitosamente al bloque del referidor de nivel ${levelId}`
        : `Has creado tu propio bloque de nivel ${levelId}. ¡Invita miembros para avanzar!`;

      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          title: referrerLevel === 1n ? '¡Te uniste al Bloque!' : '¡Bloque Creado!',
          message: notificationMessage,
          type: 'success'
        });

      const successMessage = referrerLevel === 1n
        ? '¡Te uniste al bloque del referidor!'
        : '¡Creaste tu propio bloque! Ahora invita miembros.';

      toast.success(successMessage, { id: toastId });
      onJoinSuccess();
    } catch (error: any) {
      console.error('Join block error:', error);
      toast.error(error.message || 'Error al unirse al bloque', { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  const balanceNum = parseFloat(balance);
  const hasEnoughBalance = balanceNum >= 20;

  return (
    <Card className="p-5 bg-card text-card-foreground rounded-xl">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-primary" />
          <div>
            <h3 className="text-base font-bold">Unirse con Código de Referido</h3>
            <p className="text-xs text-muted-foreground">
              Ingresa el código de quien te invitó
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="referral" className="text-sm">
            Código de Referido
          </Label>
          <Input
            id="referral"
            type="text"
            placeholder="Ej: 2E71241F"
            value={referralInput}
            onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
            className="font-mono uppercase"
            disabled={isProcessing}
          />
        </div>

        <div className="bg-secondary/20 p-3 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Costo:</span>
            <span className="font-bold text-primary">20 USDT</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Tu balance:</span>
            <span className={`font-mono font-semibold ${hasEnoughBalance ? 'text-success' : 'text-destructive'}`}>
              {balanceNum.toFixed(2)} USDT
            </span>
          </div>
        </div>

        <Button
          onClick={handleJoinBlock}
          disabled={isProcessing || !hasEnoughBalance || !referralInput.trim()}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Procesando...
            </>
          ) : (
            <>
              <LinkIcon className="w-4 h-4 mr-2" />
              Unirse con Referido
            </>
          )}
        </Button>
      </div>
    </Card>
  );
};
