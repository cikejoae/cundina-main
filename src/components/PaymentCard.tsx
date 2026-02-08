import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Loader2, CreditCard, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ReownAddFundsButton } from "@/components/ReownWalletActions";
 import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
 import { v4 as uuidv4 } from 'uuid';
import { decodeEventLog, formatUnits, parseAbi, parseUnits } from "viem";
import { CONTRACTS, USDT_TOKEN_ADDRESS } from "@/config/contracts";
import { resolveReferralCode as resolveReferralCodeOnChain, ZERO_ADDRESS } from "@/lib/contractReads";

interface PaymentCardProps {
  userId: string;
  walletAddress: string | null;
  amount: number;
  levelId: number;
  onPaymentSuccess: () => void;
  referralCode?: string | null;
}

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
]);

// Registry ABI for V5 architecture
const REGISTRY_ABI = parseAbi([
  'function registerUser(address user, address referrer, uint256 level) external',
  'function registerAndCreateBlock(address user, address referrer, uint256 level) external returns (address)',
  'function checkRegistrationStatus(address user) external view returns (bool needsPayment, uint256 currentLevel, bool hasBlockAtLevel)',
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

// PayoutModule ABI for fee dispersion
const PAYOUT_MODULE_ABI = parseAbi([
  'function disperseRegistrationFee(address user, uint256 level) external',
  'event RegistrationFeeDispersed(address indexed user, uint256 level, uint256 socCoopAmount, uint256 treasuryAmount)',
]);

export const PaymentCard = ({ userId, walletAddress, amount, levelId, onPaymentSuccess, referralCode }: PaymentCardProps) => {
  // Reown connection is exposed through Wagmi hooks (AppKit adapter)
  const { address: account, isConnected, chain } = useAccount();
  const chainId = chain?.id;

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const registryAddress = CONTRACTS.REGISTRY;
  
  // Get token balance from contract using Wagmi
  const { data: tokenDecimals } = useReadContract({
    address: USDT_TOKEN_ADDRESS,
    abi: ERC20_ABI as any,
    functionName: 'decimals',
    account: (account as `0x${string}` | undefined) ?? undefined,
    chainId,
    query: { enabled: true },
  });

  const decimals = typeof tokenDecimals === 'number' ? tokenDecimals : 18;

  const { data: tokenBalance, refetch: refetchBalance } = useReadContract({
    address: USDT_TOKEN_ADDRESS,
    abi: ERC20_ABI as any,
    functionName: 'balanceOf',
    args: account ? [account as `0x${string}`] : undefined,
    account: (account as `0x${string}` | undefined) ?? undefined,
    chainId,
    query: { enabled: !!account },
  });

  const balance = tokenBalance ? Number(formatUnits(tokenBalance as bigint, decimals)).toFixed(2) : "0";
  
  // Timeout helper to prevent hanging on flaky RPCs
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

  // On-chain actions MUST use the active Reown/Wagmi connection.
  const waitForTx = async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error('Cliente público no disponible');
    await publicClient.waitForTransactionReceipt({ hash });
  };

  const approveToken = async (spender: `0x${string}`, amountStr: string) => {
    const value = parseUnits(amountStr, decimals);
    const hash = await writeContractAsync({
      address: USDT_TOKEN_ADDRESS,
      abi: ERC20_ABI as any,
      functionName: 'approve',
      args: [spender, value],
      account: account as `0x${string}`,
      chain: (chain as any),
    });
    await waitForTx(hash);
    return hash;
  };

  const transferToken = async (to: `0x${string}`, amountStr: string) => {
    const value = parseUnits(amountStr, decimals);
    const hash = await writeContractAsync({
      address: USDT_TOKEN_ADDRESS,
      abi: ERC20_ABI as any,
      functionName: 'transfer',
      args: [to, value],
      account: account as `0x${string}`,
      chain: (chain as any),
    });
    await waitForTx(hash);
    return hash;
  };

  // Register user on-chain (required before createMyBlock for new users)
  // Now takes level parameter to charge the appropriate registration fee
  const registerUserOnChain = async (
    referrerAddress: `0x${string}` = '0x0000000000000000000000000000000000000000' as `0x${string}`,
    level: number = 1
  ): Promise<string> => {
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: 'registerUser',
      args: [account as `0x${string}`, referrerAddress, BigInt(level)],
      account: account as `0x${string}`,
      chain: (chain as any),
      gas: BigInt(500_000),
    });
    await waitForTx(txHash);
    return txHash;
  };

  // Check if user is already registered on-chain
  const checkUserLevel = async (): Promise<bigint> => {
    if (!publicClient || !account) return BigInt(0);
    try {
      const result = await (publicClient as any).readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'userLevel',
        args: [account],
      });
      return BigInt(result || 0);
    } catch {
      return BigInt(0);
    }
  };

  // Check registration status (needs payment, current level, has block)
  const checkRegistrationStatus = async (): Promise<{ needsPayment: boolean; currentLevel: bigint; hasBlockAtLevel: boolean }> => {
    if (!publicClient || !account) return { needsPayment: true, currentLevel: BigInt(0), hasBlockAtLevel: false };
    try {
      const result = await (publicClient as any).readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'checkRegistrationStatus',
        args: [account],
      });
      return {
        needsPayment: result[0] as boolean,
        currentLevel: BigInt(result[1] || 0),
        hasBlockAtLevel: result[2] as boolean,
      };
    } catch {
      return { needsPayment: true, currentLevel: BigInt(0), hasBlockAtLevel: false };
    }
  };

  // Combined register and create block - only charges if not already registered
  const registerAndCreateBlock = async (
    referrerAddress: `0x${string}` = '0x0000000000000000000000000000000000000000' as `0x${string}`,
    level: number = 1
  ): Promise<{ blockAddress: string; txHash: string }> => {
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: 'registerAndCreateBlock',
      args: [account as `0x${string}`, referrerAddress, BigInt(level)],
      account: account as `0x${string}`,
      chain: (chain as any),
      gas: BigInt(5_000_000),
    });

    if (!publicClient) throw new Error('Cliente público no disponible');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    let blockAddress: `0x${string}` | null = null;
    for (const log of receipt.logs as any[]) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
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

    return { blockAddress, txHash };
  };

  // Disperse registration fee via PayoutModule (10% to SocCoop, 90% stays in Treasury)
  // Uses timeout to prevent UI hanging on flaky networks
  const disperseRegistrationFee = async (level: number): Promise<string> => {
    const txHash = await writeContractAsync({
      address: CONTRACTS.PAYOUT_MODULE,
      abi: PAYOUT_MODULE_ABI as any,
      functionName: 'disperseRegistrationFee',
      args: [account as `0x${string}`, BigInt(level)],
      account: account as `0x${string}`,
      chain: (chain as any),
      gas: BigInt(200_000),
    });
    
    console.log('[PaymentCard] disperseRegistrationFee tx sent:', txHash);
    
    // Use withTimeout to prevent hanging on network issues
    try {
      await withTimeout(
        publicClient!.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 }),
        65_000,
        'Timeout esperando confirmación de dispersión SocCoop'
      );
      console.log('[PaymentCard] Registration fee dispersed and confirmed, tx:', txHash);
    } catch (receiptErr) {
      // Transaction was sent but confirmation timed out - likely succeeded
      console.warn('[PaymentCard] disperseRegistrationFee confirmation timeout, tx may have succeeded:', txHash, receiptErr);
    }
    
    return txHash;
  };

  const createBlock = async (newLevelId: number, referrerWallet?: string): Promise<{ blockAddress: string; txHash: string }> => {
    // Check if user is registered on-chain first
    const currentLevel = await checkUserLevel();
    console.log('[PaymentCard] createBlock - current on-chain level:', currentLevel.toString());
    
    // If user is not registered (level = 0), they need to be registered first
    // IMPORTANT: For users without referrer, registration should be done BEFORE calling createBlock
    // because registerUser() requires token approval and transfers $20 to Treasury
    if (currentLevel === BigInt(0)) {
      // Only auto-register if there's a referrer (user will join their block which handles payment)
      if (referrerWallet) {
        console.log('[PaymentCard] Auto-registering user with referrer:', referrerWallet);
        await registerUserOnChain(referrerWallet as `0x${string}`);
      } else {
        // Without referrer, registration should have been done already (with token approval)
        throw new Error('Usuario no registrado on-chain. Por favor registra primero.');
      }
    }

    // Using new Registry: createMyBlock(center) - caller is the center
    // Gas limit capped to avoid exceeding network block gas limit (16.7M on Sepolia)
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: 'createMyBlock',
      args: [account as `0x${string}`],
      account: account as `0x${string}`,
      chain: (chain as any),
      gas: BigInt(5_000_000), // Explicit gas limit under network cap
    });

    if (!publicClient) throw new Error('Cliente público no disponible');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    let blockAddress: `0x${string}` | null = null;
    for (const log of receipt.logs as any[]) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
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

    return { blockAddress, txHash };
  };

  // joinLevel1 automatically deploys the member's personal block via Registry
  // Returns txHash AND the new personal block address from MyBlockCreated event
  // NOTE: joinLevel1 is FREE (no token transfer) - registration is separate
  const joinBlock = async (blockAddress: string): Promise<{ txHash: string; personalBlockAddress: string | null }> => {
    // joinLevel1 does NOT require token approval - it's free
    // The registration fee was already paid in registerUser()
    
    // V5: joinLevel1(member) — target block auto-resolved from referrer's L1 block
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: 'joinLevel1',
      args: [account as `0x${string}`],
      account: account as `0x${string}`,
      chain: (chain as any),
      gas: BigInt(5_000_000),
    });
    
    if (!publicClient) throw new Error('Cliente público no disponible');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    
    // Extract the personal block address from MyBlockCreated event
    // joinLevel1 automatically deploys a personal block for the member
    let personalBlockAddress: string | null = null;
    for (const log of receipt.logs as any[]) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: REGISTRY_ABI as any,
          data: log.data,
          topics: log.topics,
        }) as any;
        if (decoded?.eventName === 'MyBlockCreated') {
          personalBlockAddress = decoded?.args?.blockAddress as string;
          console.log('[PaymentCard] Personal block created via joinLevel1:', personalBlockAddress);
          break;
        }
      } catch {
        // ignore non-matching logs
      }
    }
    
    return { txHash, personalBlockAddress };
  };

  const transferToMultipleWallets = async (transfers: { to: string; amount: string }[]): Promise<string[]> => {
    const hashes: string[] = [];
    for (const t of transfers) {
      const h = await transferToken(t.to as `0x${string}`, t.amount);
      hashes.push(h);
    }
    return hashes;
  };
  const [isProcessing, setIsProcessing] = useState(false);
  const [referrerBlock, setReferrerBlock] = useState<{
    id: string;
    contract_address: string;
    current_members: number;
    required_members: number;
    referrerWallet: string;
  } | null>(null);
  // NOTE: referrerHighestBlock removed - invited_members_count is now tracked on-chain
  const [isLoadingReferrer, setIsLoadingReferrer] = useState(false);

  // Some referral flows originate from a specific /block/:id invitation.
  // Reading user_wallets by referral_code is restricted by RLS, so we prefer resolving
  // the referrer from that block context when available.
  const getReferralSourceBlockId = (): string | null => {
    // If BlockDetail stored an explicit source block id, prefer it.
    const explicit = localStorage.getItem('referrerSourceBlockId');
    if (explicit) return explicit;

    const redirect = localStorage.getItem('postAuthRedirect') || '';
    const m = redirect.match(/\/block\/([0-9a-fA-F-]{36})/);
    return m?.[1] ?? null;
  };

  const resolveReferrerFromSourceBlock = async (): Promise<{
    walletAddress: `0x${string}` | null;
    l1JoinCandidate: null;
  }> => {
    // Fast path: BlockDetail may have stored the inviter wallet directly.
    const storedWalletAddress = localStorage.getItem('referrerSourceWalletAddress');
    const storedWalletAddressOk = storedWalletAddress?.startsWith('0x')
      ? (storedWalletAddress as `0x${string}`)
      : null;

    // Block data now lives on-chain only - resolve via stored wallet address
    return {
      walletAddress: storedWalletAddressOk,
      l1JoinCandidate: null,
    };
  };

  // Check if referral code exists and find the referrer's block
  // IMPORTANT: Invitees ALWAYS pay $20 (Level 1), regardless of the inviter's level
  // If inviter is L2+, we increment invited_members_count on their highest level block
  useEffect(() => {
    const checkReferrerBlock = async () => {
      if (!referralCode) return;
      
      setIsLoadingReferrer(true);
      try {
        // 1) Prefer resolving from invitation block context
        const resolved = await resolveReferrerFromSourceBlock();
        let referrerWalletAddress: string | null = resolved.walletAddress;

         // l1JoinCandidate is always null in the on-chain architecture
         // Block joining is handled directly via contract calls

        // 2) Try resolving on-chain first (for bytes32 codes like 64-char hex)
        if (!referrerWalletAddress && publicClient) {
          try {
            // Check if it looks like a bytes32 code (64 hex chars) or wallet address
            if (/^[a-fA-F0-9]{64}$/i.test(referralCode) || /^0x[a-fA-F0-9]{40}$/i.test(referralCode)) {
              console.log('[PaymentCard] Resolving referral code on-chain:', referralCode);
              const resolvedWallet = await resolveReferralCodeOnChain(publicClient, referralCode);
              if (resolvedWallet && resolvedWallet !== ZERO_ADDRESS) {
                referrerWalletAddress = resolvedWallet;
                // Store for future use
                localStorage.setItem('referrerSourceWalletAddress', resolvedWallet);
                console.log('[PaymentCard] Resolved on-chain referrer:', resolvedWallet);
              }
            }
          } catch (err) {
            console.warn('[PaymentCard] On-chain referral resolution failed:', err);
          }
        }

        // 3) Fallback to lookup by referral code in DB (for legacy 8-char codes)
        if (!referrerWalletAddress) {
          const { data: referrerWallet } = await supabase
            .from('user_wallets')
            .select('id, wallet_address')
            .eq('referral_code', referralCode.toUpperCase())
            .maybeSingle();

          if (!referrerWallet) {
            console.log('[PaymentCard] No wallet found for referral code:', referralCode);
            // Don't return early - might still be able to use direct wallet address
          }

          if (referrerWallet) {
            referrerWalletAddress = (referrerWallet as any).wallet_address;
          }
        }

        // If we still have no referrer, can't proceed with referral-based join
        if (!referrerWalletAddress) {
          console.log('[PaymentCard] Could not resolve referrer wallet address');
          return;
        }

        // Find referrer's L1 block on-chain via Registry.myBlockAtLevel
        if (publicClient && referrerWalletAddress && !resolved.l1JoinCandidate) {
          try {
            const referrerL1Block = await (publicClient as any).readContract({
              address: registryAddress,
              abi: REGISTRY_ABI,
              functionName: 'myBlockAtLevel',
              args: [referrerWalletAddress as `0x${string}`, 1n],
            });
            
            const blockAddr = String(referrerL1Block || '').toLowerCase();
            
            if (blockAddr && blockAddr !== '0x0000000000000000000000000000000000000000') {
              // Check block capacity via on-chain snapshot
              try {
                const [reqMembersRaw, statusRaw] = await Promise.all([
                  (publicClient as any).readContract({ address: blockAddr as `0x${string}`, abi: parseAbi(['function requiredMembers() external view returns (uint256)']), functionName: 'requiredMembers' }),
                  (publicClient as any).readContract({ address: blockAddr as `0x${string}`, abi: parseAbi(['function status() external view returns (uint8)']), functionName: 'status' }),
                ]);

                let curMembers = 0;
                try {
                  const mc = await (publicClient as any).readContract({ address: blockAddr as `0x${string}`, abi: parseAbi(['function membersCount() external view returns (uint256)']), functionName: 'membersCount' });
                  curMembers = Number(BigInt(mc ?? 0));
                } catch {
                  try {
                    const members = await (publicClient as any).readContract({ address: blockAddr as `0x${string}`, abi: parseAbi(['function getMembers() external view returns (address[] memory)']), functionName: 'getMembers' });
                    curMembers = Array.isArray(members) ? members.length : 0;
                  } catch { curMembers = 0; }
                }

                const reqMembers = Number(BigInt(reqMembersRaw ?? 9));
                const isActive = BigInt(statusRaw ?? 0) === 0n;
                
                if (isActive && curMembers < reqMembers && referrerWalletAddress) {
                  setReferrerBlock({
                    id: blockAddr,
                    contract_address: blockAddr,
                    current_members: curMembers,
                    required_members: reqMembers,
                    referrerWallet: referrerWalletAddress,
                  });
                } else {
                  console.log('[PaymentCard] Referrer L1 block is full or inactive');
                }
              } catch (snapErr) {
                console.warn('[PaymentCard] Error reading referrer block snapshot:', snapErr);
              }
            } else {
              console.log('[PaymentCard] Referrer has no L1 block on-chain');
            }
          } catch (err) {
            console.warn('[PaymentCard] Error checking referrer L1 block on-chain:', err);
          }
        }
      } catch (error) {
        console.error('Error checking referrer block:', error);
      } finally {
        setIsLoadingReferrer(false);
      }
    };

    checkReferrerBlock();
  }, [referralCode, publicClient]);

  // Helper to get referrer wallet ID from code
  const getReferrerWalletAddress = async (code: string): Promise<string | null> => {
    const storedWalletAddress = localStorage.getItem('referrerSourceWalletAddress');
    if (storedWalletAddress?.startsWith('0x')) return storedWalletAddress;

    // Prefer invitation block context
    const resolved = await resolveReferrerFromSourceBlock();
    if (resolved.walletAddress) return resolved.walletAddress;

    // Fallback to DB lookup by code
    const { data } = await supabase
      .from('user_wallets')
      .select('wallet_address')
      .eq('referral_code', code.toUpperCase())
      .maybeSingle();
    return (data as any)?.wallet_address || null;
  };

  const resolveReferrerWalletAddress = async (): Promise<`0x${string}`> => {
    const storedWalletAddress = localStorage.getItem('referrerSourceWalletAddress');
    if (storedWalletAddress?.startsWith('0x')) {
      return storedWalletAddress as `0x${string}`;
    }

    // If we already resolved a joinable L1 referrerBlock, that has the wallet.
    if (referrerBlock?.referrerWallet?.startsWith('0x')) {
      return referrerBlock.referrerWallet as `0x${string}`;
    }

    // Prefer invitation block context
    const resolved = await resolveReferrerFromSourceBlock();
    if (resolved.walletAddress) return resolved.walletAddress;

    // Try on-chain resolution for bytes32 codes
    if (referralCode && publicClient) {
      try {
        if (/^[a-fA-F0-9]{64}$/i.test(referralCode) || /^0x[a-fA-F0-9]{40}$/i.test(referralCode)) {
          const resolvedWallet = await resolveReferralCodeOnChain(publicClient, referralCode);
          if (resolvedWallet && resolvedWallet !== ZERO_ADDRESS) {
            return resolvedWallet as `0x${string}`;
          }
        }
      } catch (err) {
        console.warn('[PaymentCard] On-chain resolution failed in resolveReferrerWalletAddress:', err);
      }
    }

    // Fallback to lookup by referral code in DB (legacy 8-char codes)
    if (referralCode) {
      const { data } = await supabase
        .from('user_wallets')
        .select('wallet_address')
        .eq('referral_code', referralCode.toUpperCase())
        .maybeSingle();

      const addr = (data as any)?.wallet_address as string | undefined;
      if (addr?.startsWith('0x')) return addr as `0x${string}`;
    }

    return '0x0000000000000000000000000000000000000000' as `0x${string}`;
  };

  const handlePayment = async () => {
    if (!account) {
      toast.error("Conecta tu billetera primero");
      return;
    }

    const balanceNum = parseFloat(balance);
    if (balanceNum < amount) {
      toast.error(`Balance insuficiente. Necesitas ${amount} USDT`);
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading("Procesando pago...");
    
    try {
      // Use wallet address directly instead of UUID
      const activeWalletAddress = walletAddress || account?.toLowerCase() || null;
      
      if (!activeWalletAddress) {
        toast.error("No se detectó una wallet conectada", { id: toastId });
        setIsProcessing(false);
        return;
      }
      
      // Verify profile exists (may be needed for notifications)
      toast.loading("Verificando perfil...", { id: toastId });

      const { data: existingProfile, error: profileCheckError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (profileCheckError) throw profileCheckError;

      // If profile doesn't exist, create it from auth.users metadata
      if (!existingProfile) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        
        if (!authUser) {
          toast.error("Sesión expirada. Por favor inicia sesión nuevamente.", { id: toastId });
          setIsProcessing(false);
          return;
        }

        const metadata = authUser.user_metadata || {};
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            full_name: metadata.full_name || '',
            email: authUser.email || '',
            phone: metadata.phone || '',
            whatsapp: metadata.whatsapp || null,
            telegram: metadata.telegram || null,
            wallet_address: activeWalletAddress,
            referral_code: Math.random().toString(36).substring(2, 10).toUpperCase(),
          });

        if (profileError) {
          console.error('Error creating profile:', profileError);
          toast.error("Error al crear perfil. Por favor intenta nuevamente.", { id: toastId });
          setIsProcessing(false);
          return;
        }
      }

      let blockId: string;
      let blockAddress: string;
      let txHash: string;

      // Keep track of the block the user ACTUALLY joined (referrer block when there is referral)
      let joinedBlockId: string | null = null;
      let joinedBlockAddress: string | null = null;

      // If referrer block exists and has space, join it
      // joinLevel1 AUTOMATICALLY deploys the member's personal block on-chain
      if (referrerBlock) {
        joinedBlockId = referrerBlock.id;
        joinedBlockAddress = referrerBlock.contract_address;

        // STEP 1: Check if user needs to be registered on-chain first
        const currentLevel = await checkUserLevel();
        console.log('[PaymentCard] Join flow - current on-chain level:', currentLevel.toString());
        
        if (currentLevel === BigInt(0)) {
          // User not registered - need to register first (this costs 20 USDT)
          // Get referrer wallet address for on-chain registration
          const referrerWalletAddress = referrerBlock.referrerWallet as `0x${string}`;
          
          // Get registration fee for level 1
          let registrationFeeWei = parseUnits('20', decimals); // Default 20 USDT
          try {
            const feeResult = await publicClient?.readContract({
              address: registryAddress,
              abi: REGISTRY_ABI as any,
              functionName: 'registrationFee',
              args: [BigInt(1)],
            } as any);
            if (feeResult) registrationFeeWei = feeResult as bigint;
          } catch (err) {
            console.warn('[PaymentCard] registrationFee() not available, using default 20 USDT');
          }
          
          // Approve tokens to REGISTRY for registration fee
          toast.loading("Aprobando tokens para registro...", { id: toastId });
          await approveToken(registryAddress, formatUnits(registrationFeeWei, decimals));
          
          // Register user on-chain with referrer
          toast.loading("Registrando usuario on-chain...", { id: toastId });
          await registerUserOnChain(referrerWalletAddress, levelId);
          console.log('[PaymentCard] User registered on-chain');
        }

        // STEP 2: Join the referrer's block (FREE - no token transfer needed)
        // joinLevel1 automatically creates member's personal block
        toast.loading("Uniéndote al bloque del invitador...", { id: toastId });
        const { txHash: joinTxHash, personalBlockAddress } = await joinBlock(referrerBlock.contract_address);
        txHash = joinTxHash;

        // Notify the referrer via wallet address lookup
        if (referrerBlock?.referrerWallet) {
          const { data: referrerWalletData } = await supabase
            .from('user_wallets')
            .select('user_id')
            .ilike('wallet_address', referrerBlock.referrerWallet)
            .maybeSingle();
          
          if (referrerWalletData && referrerWalletData.user_id !== userId) {
            await supabase
              .from('notifications')
              .insert({
                user_id: referrerWalletData.user_id,
                title: '¡Nuevo miembro!',
                message: 'Un nuevo miembro se ha unido a tu bloque',
                type: 'info'
              });
          }
        }

        // The personal block was created automatically by joinLevel1
        if (!personalBlockAddress) {
          console.error('[PaymentCard] joinLevel1 did not emit MyBlockCreated event');
          throw new Error('No se pudo obtener la dirección del bloque personal creado');
        }

        blockId = personalBlockAddress;
        blockAddress = personalBlockAddress;

        // NOTE: Block registration, level progress, and invited_members_count
        // are now tracked entirely on-chain and indexed by the Subgraph.

      } else if (referralCode) {
        // CASE: Referrer is L2+ and their L1 block is full/completed
        // Invitee creates their OWN L1 block
        console.log('[PaymentCard] Referrer without available L1 space, creating independent block');
        
        // Check if user needs to pay
        const { needsPayment, hasBlockAtLevel } = await checkRegistrationStatus();
        
        if (hasBlockAtLevel) {
          toast.error("Ya tienes un bloque en este nivel", { id: toastId });
          setIsProcessing(false);
          return;
        }
        
        // Get referrer wallet address for on-chain registration
        const referrerWalletAddress = await resolveReferrerWalletAddress();
        
        // Only approve tokens if user needs to pay
        if (needsPayment) {
          toast.loading("Aprobando tokens...", { id: toastId });
          await approveToken(CONTRACTS.REGISTRY, amount.toString());
        }
        
        // Combined register + create block
        toast.loading(needsPayment ? "Registrando y creando bloque..." : "Creando bloque...", { id: toastId });
        const { blockAddress: newBlockAddress, txHash: createTxHash } = await registerAndCreateBlock(
          referrerWalletAddress as `0x${string}`,
          levelId
        );
        blockAddress = newBlockAddress;
        txHash = createTxHash;
        
        // Disperse registration fee
        if (needsPayment) {
          toast.loading("Dispersando comisiones (10% PI)...", { id: toastId });
          try {
            await disperseRegistrationFee(levelId);
          } catch (disperseError) {
            console.error('[PaymentCard] Error dispersing registration fee:', disperseError);
          }
        }

        // NOTE: Block data, transactions, and level progress are now tracked
        // entirely on-chain and indexed by the Subgraph. No database sync needed.

        // Notify referrer via wallet lookup
        if (referrerWalletAddress && referrerWalletAddress !== '0x0000000000000000000000000000000000000000') {
          const { data: referrerUserData } = await supabase
            .from('user_wallets')
            .select('user_id')
            .ilike('wallet_address', referrerWalletAddress)
            .maybeSingle();
            
          if (referrerUserData && referrerUserData.user_id !== userId) {
            await supabase
              .from('notifications')
              .insert({
                user_id: referrerUserData.user_id,
                title: '¡Nuevo participante invitado!',
                message: 'Un nuevo usuario se registró con tu invitación.',
                type: 'success'
              });
          }
        }
        
        toast.success("¡Registro completado!", { id: toastId });
        onPaymentSuccess();
        return;

      } else {
        // No referrer block to join, but may still have a referral code
        // Use combined registerAndCreateBlock - only charges if not already registered
        
        // Check if user needs to pay (might already be registered from a failed attempt)
        const { needsPayment, hasBlockAtLevel } = await checkRegistrationStatus();
        
        if (hasBlockAtLevel) {
          toast.error("Ya tienes un bloque en este nivel", { id: toastId });
          setIsProcessing(false);
          return;
        }
        
        // Get referrer wallet address if we have a referral code (prefer block invitation context)
        const referrerWalletAddress = await resolveReferrerWalletAddress();
        
        // Only approve tokens if user needs to pay
        if (needsPayment) {
          toast.loading("Aprobando tokens...", { id: toastId });
          await approveToken(CONTRACTS.REGISTRY, amount.toString());
        } else {
          toast.loading("Ya estás registrado, creando bloque...", { id: toastId });
        }
        
        // Combined register + create block (only charges if not registered)
        toast.loading(needsPayment ? "Registrando y creando bloque..." : "Creando bloque...", { id: toastId });
        const { blockAddress: newBlockAddress, txHash: createTxHash } = await registerAndCreateBlock(
          referrerWalletAddress,
          levelId
        );
        blockAddress = newBlockAddress;
        txHash = createTxHash;
        console.log('[PaymentCard] Block created at:', blockAddress, 'tx:', txHash, 'paid:', needsPayment, 'referrer:', referrerWalletAddress);
        
        // DISPERSE REGISTRATION FEE: 10% to PI, 90% stays in Treasury
        if (needsPayment) {
          toast.loading("Dispersando comisiones (10% PI)...", { id: toastId });
          try {
            await disperseRegistrationFee(levelId);
            console.log('[PaymentCard] Registration fee dispersed successfully');
          } catch (disperseError) {
            console.error('[PaymentCard] Error dispersing registration fee:', disperseError);
            // Don't fail the whole flow, just log the error - Treasury can disperse later
            toast.warning("Bloque creado, pero la dispersión de comisiones falló. Se procesará manualmente.");
          }
        }
        
        // NOTE: Block data, transactions, and level progress are now tracked
        // entirely on-chain and indexed by the Subgraph. No database sync needed.
        blockId = blockAddress; // Use contract address as block ID
          
        // Create notification about registration
        await supabase
          .from('notifications')
          .insert({
            user_id: userId,
            title: needsPayment ? 'Registro Completado' : 'Bloque Creado',
            message: needsPayment 
              ? `Te has registrado exitosamente y tu bloque nivel ${levelId} está activo. ¡Comienza a invitar miembros!`
              : `Tu bloque nivel ${levelId} ha sido creado (sin cobro adicional ya que estabas registrado). ¡Comienza a invitar miembros!`,
            type: 'success'
          });

        toast.success(needsPayment ? "¡Registro completado y bloque creado!" : "¡Bloque creado sin cobro adicional!", { id: toastId });
        onPaymentSuccess();
        return; // Exit early since we handled everything
      }

      // NOTE: Transaction records are now tracked entirely on-chain
      // and indexed by the Subgraph. No database sync needed.

      // Create notification
      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          title: referrerBlock ? '¡Te uniste al bloque!' : 'Pago Confirmado',
          message: referrerBlock 
            ? `Te uniste al bloque del invitador y se creó tu propio bloque nivel ${levelId}.`
            : `Tu pago de ${amount} USDT ha sido procesado. Has sido asignado al bloque.`,
          type: 'success'
        });

      toast.success(
        referrerBlock 
          ? "¡Te uniste y se creó tu bloque!" 
          : "¡Pago completado! Asignado a bloque", 
        { id: toastId }
      );
      onPaymentSuccess();
    } catch (error: any) {
      console.error('Payment error:', error);
      toast.error(error.message || "Error al procesar el pago", { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  const balanceNum = parseFloat(balance);
  const hasEnoughBalance = balanceNum >= amount;

  return (
    <Card className="p-4 md:p-6 glass border-warning/50 glow">
      <div className="space-y-3 md:space-y-4">
        <div className="flex items-start gap-2 md:gap-3">
          <AlertCircle className="w-5 h-5 md:w-6 md:h-6 text-warning flex-shrink-0 mt-0.5 md:mt-1" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base md:text-lg font-semibold text-warning">Pago Pendiente</h3>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              Para activar tu nivel y comenzar a participar, necesitas realizar el pago de contribución.
            </p>
          </div>
        </div>

        {/* Show referrer block info if exists */}
        {isLoadingReferrer ? (
          <div className="bg-primary/10 p-3 rounded-lg flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Buscando bloque del invitador...</span>
          </div>
        ) : referrerBlock && (
          <div className="bg-primary/10 border border-primary/30 p-3 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Te unirás al bloque del invitador</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Wallet: {referrerBlock.referrerWallet.slice(0, 6)}...{referrerBlock.referrerWallet.slice(-4)}</p>
              <p>Miembros: {referrerBlock.current_members}/{referrerBlock.required_members}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Además se creará tu propio bloque nivel 1 para que invites a otros.
            </p>
          </div>
        )}

        <div className="bg-background/50 p-3 md:p-4 rounded-lg border border-border space-y-2 md:space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs md:text-sm text-muted-foreground">Monto a pagar:</span>
            <span className="text-xl md:text-2xl font-mono font-bold text-primary">
              {amount} USDT
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs md:text-sm">
            <span className="text-muted-foreground">Tu balance:</span>
            <span className={`font-mono font-semibold ${hasEnoughBalance ? 'text-success' : 'text-destructive'}`}>
              {balanceNum.toFixed(2)} USDT
            </span>
          </div>

          {!hasEnoughBalance && (
            <div className="flex items-start gap-2 p-2 md:p-3 bg-destructive/10 rounded border border-destructive/30">
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">
                Balance insuficiente. Necesitas al menos {amount} USDT para completar el pago.
              </p>
            </div>
          )}
        </div>

        <Button
          onClick={handlePayment}
          disabled={isProcessing || !hasEnoughBalance || isLoadingReferrer}
          className="w-full h-12 md:h-14 text-base md:text-lg bg-primary hover:bg-primary/90 touch-manipulation active:scale-95 transition-transform"
          size="lg"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 md:w-5 md:h-5 mr-2 animate-spin" />
              <span className="truncate">Procesando...</span>
            </>
          ) : (
            <>
              <CreditCard className="w-4 h-4 md:w-5 md:h-5 mr-2 flex-shrink-0" />
              <span className="truncate">
                {referrerBlock ? `Unirse y aportar ${amount} USDT` : `Aporte ${amount} USDT`}
              </span>
            </>
          )}
        </Button>

        <div className="flex flex-col items-center gap-2 pt-1 md:pt-2">
          <p className="text-xs text-muted-foreground text-center px-2">
            {referrerBlock 
              ? "Te unirás al bloque del invitador y se creará tu propio bloque."
              : "Una vez completado el pago, tu nivel se activará automáticamente."}
          </p>
          {!hasEnoughBalance && (
            <ReownAddFundsButton 
              variant="ghost"
              size="sm"
              label="¿Necesitas fondos? Agregar aquí"
            />
          )}
        </div>
      </div>
    </Card>
  );
};
