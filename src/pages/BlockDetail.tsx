import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ChevronLeft, Users, UserPlus, Share2, Check, RefreshCw } from "lucide-react";
import { Navigation } from "@/components/Navigation";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { BlockCompletionModal } from "@/components/BlockCompletionModal";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { decodeEventLog, formatUnits, parseAbi, parseUnits } from "viem";
import { CONTRACTS, USDT_TOKEN_ADDRESS, USDT_DECIMALS } from "@/config/contracts";
import { querySubgraph, BLOCK_DETAILS_QUERY, type BlockDetailsQueryResult } from "@/lib/subgraph";
import { getBlockNumber } from "@/lib/blockNumbering";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { readReferralCode } from "@/lib/contractReads";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

// Registry ABI for the new EOA Treasury architecture
const REGISTRY_ABI = parseAbi([
  // NOTE: V5 registry
  "function registerUser(address user, address referrer, uint256 level) external",
  "function registerAndCreateBlock(address user, address referrer, uint256 level) external returns (address)",
  "function createMyBlock(address center) external returns (address)",
  "function joinLevel1(address member) external",
  "function joinTargetBlock(address member, address targetBlock) external",
  "function userLevel(address user) external view returns (uint256)",
  "function myBlockAtLevel(address user, uint256 level) external view returns (address)",
  "function registrationFee(uint256 level) external view returns (uint256)",
  "function referrerOf(address user) external view returns (address)",
  "event UserRegistered(address indexed user, address indexed referrer, uint256 level)",
  "event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress)",
  "event MemberJoined(address indexed member, uint256 indexed position, uint256 amount)",
]);

// PayoutModule ABI for SocCoop dispersion (10% of registration fee)
const PAYOUT_MODULE_ABI = parseAbi(["function disperseRegistrationFee(address user, uint256 level) external"]);

// Block ABI for preflight validation (capacity/status) before submitting join tx.
// Some revisions expose membersCount(); others only expose getMembers().
const BLOCK_INFO_ABI = parseAbi([
  "function requiredMembers() external view returns (uint256)",
  "function membersCount() external view returns (uint256)",
  "function getMembers() external view returns (address[] memory)",
  "function contributionAmount() external view returns (uint256)",
  "function status() external view returns (uint8)",
  "function owner() external view returns (address)",
  "function registry() external view returns (address)",
]);

interface BlockMember {
  id: string;
  position: number;
  user_wallets: {
    wallet_address: string;
  } | null;
}

interface BlockDetails {
  id: string;
  block_number: number;
  /** Número relativo dentro del nivel (1..N) */
  level_block_number?: number;
  level_id: number;
  current_members: number;
  status: string;
  contract_address: string | null;
  creator_wallet_address: string | null;
  creator_id: string;
  levels: {
    name: string;
    contribution_amount: number;
    total_cundina: number;
    required_members: number;
  };
}

interface NextLevelInfo {
  id: number;
  name: string;
  contribution_amount: number;
}

const BlockDetail = () => {
  const { blockId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  // Wagmi / Reown hooks
  const { address: account, isConnected, chain } = useAccount();
  const { open: openAppKit } = useAppKit();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const registryAddress = CONTRACTS.REGISTRY;

  // Token balance
  const { data: tokenDecimals } = useReadContract({
    address: USDT_TOKEN_ADDRESS,
    abi: ERC20_ABI as any,
    functionName: "decimals",
    chainId: chain?.id,
    query: { enabled: true },
  });
  const decimals = typeof tokenDecimals === "number" ? tokenDecimals : 18;

  const { data: tokenBalance, refetch: refetchBalance } = useReadContract({
    address: USDT_TOKEN_ADDRESS,
    abi: ERC20_ABI as any,
    functionName: "balanceOf",
    args: account ? [account as `0x${string}`] : undefined,
    chainId: chain?.id,
    query: { enabled: !!account },
  });
  const balance = tokenBalance ? Number(formatUnits(tokenBalance as bigint, decimals)).toFixed(2) : "0";

  const getViemErrorMessage = (err: unknown) => {
    const e = err as any;
    // Walk the full cause chain to find the most specific revert reason
    let msg = e?.shortMessage || e?.cause?.shortMessage || e?.cause?.cause?.shortMessage || '';
    const details = e?.details || e?.cause?.details || e?.cause?.cause?.details || '';
    const metaMessages = e?.metaMessages || e?.cause?.metaMessages || [];
    
    // If we have revert data, include it
    if (e?.data || e?.cause?.data) {
      const data = e?.data || e?.cause?.data;
      if (typeof data === 'string' && data !== '0x') {
        msg += ` [data: ${data}]`;
      }
    }
    
    if (details && !msg.includes(details)) {
      msg = msg ? `${msg} — ${details}` : details;
    }
    if (metaMessages.length > 0) {
      msg += ' ' + metaMessages.join(' ');
    }
    
    return msg || e?.message || "Error desconocido";
  };

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

  // Helper functions for on-chain operations
  const waitForTx = async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error("Cliente público no disponible");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // CRITICAL: Verify transaction was successful (status = 1)
    if (receipt.status !== "success") {
      throw new Error("La transacción falló en blockchain. No se realizaron cambios.");
    }
    return receipt;
  };

  const approveToken = async (spender: `0x${string}`, amount: string | bigint) => {
    const value = typeof amount === "bigint" ? amount : parseUnits(amount, decimals);
    const hash = await writeContractAsync({
      address: USDT_TOKEN_ADDRESS,
      abi: ERC20_ABI as any,
      functionName: "approve",
      args: [spender, value],
      account: account as `0x${string}`,
      chain: chain as any,
    });
    await waitForTx(hash);
    return hash;
  };

  const getRegistrationFeeWei = async (levelId: number): Promise<bigint> => {
    if (!publicClient) throw new Error("Cliente público no disponible");
    try {
      const fee = await (publicClient as any).readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: "registrationFee",
        args: [BigInt(levelId)],
      });
      return BigInt(fee || 0);
    } catch (err) {
      console.warn("[BlockDetail] registrationFee() not available, using fallback", err);
      return levelId === 1 ? parseUnits("20", decimals) : 0n;
    }
  };

  const getTokenBalanceWei = async (): Promise<bigint> => {
    if (!publicClient || !account) return 0n;
    try {
      const bal = await (publicClient as any).readContract({
        address: USDT_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account as `0x${string}`],
      });
      return BigInt(bal || 0);
    } catch (err) {
      console.warn("[BlockDetail] getTokenBalanceWei failed, defaulting to 0", err);
      return 0n;
    }
  };

  const readBlockSnapshot = async (blockAddress: `0x${string}`) => {
    if (!publicClient) return null;
    try {
      const [requiredMembers, contributionAmount, status, owner] = await Promise.all([
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: "requiredMembers",
        }),
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: "contributionAmount",
        }),
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: "status",
        }),
        (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: "owner",
        }),
      ]);

      let membersCount = 0n;
      try {
        const mc = await (publicClient as any).readContract({
          address: blockAddress,
          abi: BLOCK_INFO_ABI,
          functionName: "membersCount",
        });
        membersCount = BigInt(mc ?? 0);
      } catch {
        try {
          const members = await (publicClient as any).readContract({
            address: blockAddress,
            abi: BLOCK_INFO_ABI,
            functionName: "getMembers",
          });
          membersCount = BigInt(Array.isArray(members) ? members.length : 0);
        } catch {
          membersCount = 0n;
        }
      }

      return {
        requiredMembers: BigInt(requiredMembers ?? 0),
        membersCount,
        contributionAmount: BigInt(contributionAmount ?? 0),
        status: BigInt(status ?? 0),
        owner: String(owner ?? "") as `0x${string}`,
      };
    } catch (err) {
      console.warn("[BlockDetail] readBlockSnapshot failed:", err);
      return null;
    }
  };

  // Check if user is already registered on-chain
  const checkUserLevel = async (): Promise<bigint> => {
    if (!publicClient || !account) return BigInt(0);
    try {
      const result = await (publicClient as any).readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: "userLevel",
        args: [account],
      });
      return BigInt(result || 0);
    } catch {
      return BigInt(0);
    }
  };

  // Register user on-chain (required before createMyBlock for new users)
  const registerUserOnChain = async (
    referrerAddress: `0x${string}` = "0x0000000000000000000000000000000000000000" as `0x${string}`,
    level: number = 1,
  ): Promise<string> => {
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: "registerUser",
      args: [account as `0x${string}`, referrerAddress, BigInt(level)],
      account: account as `0x${string}`,
      chain: chain as any,
      gas: BigInt(500_000),
    });
    await waitForTx(txHash);
    return txHash;
  };

  // Join block using Registry.joinLevel1 (correct EOA Treasury architecture)
  // Returns txHash and the user's personal block address if created during the join
  const joinBlockOnChain = async (
    blockAddress: string,
    joinAmount: string,
    referrerWallet?: string,
    levelId: number = 1,
  ): Promise<{ txHash: string; myBlockAddress: string | null }> => {
    // PRE-FLIGHT (on-chain): validate block status/capacity and registry compatibility.
    const snapshot = await readBlockSnapshot(blockAddress as `0x${string}`);
    if (snapshot) {
      // status: 0 = Active
      if (snapshot.status !== 0n) {
        throw new Error("Este bloque ya está completado en blockchain y no acepta más miembros.");
      }

      if (snapshot.requiredMembers > 0n && snapshot.membersCount >= snapshot.requiredMembers) {
        throw new Error(
          `Este bloque ya no tiene cupos en blockchain (${snapshot.membersCount.toString()}/${snapshot.requiredMembers.toString()} miembros registrados).`,
        );
      }
    }

    // REGISTRY COMPATIBILITY CHECK: Ensure the block was created by the current registry
    if (publicClient) {
      try {
        const blockRegistry = await (publicClient as any).readContract({
          address: blockAddress as `0x${string}`,
          abi: BLOCK_INFO_ABI,
          functionName: "registry",
        });
        const blockRegistryAddr = String(blockRegistry || "").toLowerCase();
        const currentRegistryAddr = registryAddress.toLowerCase();
        console.log("[BlockDetail] Block registry:", blockRegistryAddr, "Current registry:", currentRegistryAddr);
        if (blockRegistryAddr && blockRegistryAddr !== currentRegistryAddr) {
          throw new Error(
            `Este bloque pertenece a un registro anterior (${blockRegistryAddr.slice(0, 10)}…) y no es compatible con el registro actual V5. ` +
              `Solo puedes unirte a bloques creados en el registro vigente.`,
          );
        }
      } catch (err: any) {
        if (err.message?.includes("pertenece a un registro")) throw err;
        console.warn("[BlockDetail] registry() check failed (block may be legacy):", err);
        // If registry() doesn't exist, the block is likely from an older version
        throw new Error(
          "No se pudo verificar la compatibilidad de este bloque. " +
            "Es posible que pertenezca a un despliegue anterior y no sea compatible con el registro actual.",
        );
      }
    }

    // STEP 1: Check if user is registered on-chain first
    const currentLevel = await checkUserLevel();
    console.log("[BlockDetail] User on-chain level:", currentLevel.toString());

    // CRITICAL: For Level 1 blocks, the contract requires userLevel == 1.
    // If user has a higher level, they cannot join L1 blocks anymore.
    if (levelId === 1 && currentLevel > 1n) {
      throw new Error(
        `Tu nivel on-chain es ${currentLevel.toString()}. No puedes unirte a bloques de Nivel 1 porque ya avanzaste. ` +
          `Solo puedes unirte a bloques de tu nivel actual o superior.`,
      );
    }

    // Check if user is already a member of THIS specific target block
    if (currentLevel >= 1n && publicClient) {
      try {
        const members = await (publicClient as any).readContract({
          address: blockAddress as `0x${string}`,
          abi: BLOCK_INFO_ABI,
          functionName: "getMembers",
        });
        const membersList = Array.isArray(members)
          ? members.map((m: string) => m.toLowerCase())
          : [];
        if (account && membersList.includes(account.toLowerCase())) {
          throw new Error(
            "Ya eres miembro de este bloque. No puedes unirte de nuevo.",
          );
        }
      } catch (err: any) {
        if (err.message?.includes("Ya eres miembro")) throw err;
        console.warn("[BlockDetail] getMembers check failed (non-critical):", err);
      }
    }

    const needsRegistration = currentLevel === 0n;

    const referrerAddress = referrerWallet
      ? (referrerWallet as `0x${string}`)
      : ("0x0000000000000000000000000000000000000000" as `0x${string}`);

    // V5 REQUIREMENT: joinLevel1 auto-resolves target block from referrerOf[member].
    // If user has no referrer set on-chain, the contract will revert with "No referrer".
    // Check this BEFORE attempting the join to give a clear error.
    if (!needsRegistration && publicClient) {
      try {
        const onChainReferrer = await (publicClient as any).readContract({
          address: registryAddress,
          abi: REGISTRY_ABI,
          functionName: "referrerOf",
          args: [account as `0x${string}`],
        });
        const refAddr = String(onChainReferrer || "").toLowerCase();
        console.log("[BlockDetail] referrerOf on-chain:", refAddr);
        if (!refAddr || refAddr === "0x0000000000000000000000000000000000000000") {
          throw new Error(
            "Tu cuenta no tiene un referido asignado on-chain. " +
              "Necesitas registrarte con un código de referido válido para unirte a un bloque.",
          );
        }
      } catch (err: any) {
        if (err.message?.includes("referido asignado")) throw err;
        console.warn("[BlockDetail] referrerOf check failed:", err);
      }
    }

    // IMPORTANT:
    // - registerUser() pulls the REGISTRATION FEE from the user (spender = REGISTRY)
    // - joinLevel1() is a FREE OPERATION - no additional token transfer needed
    // The registration fee already covers the contribution (consolidated flow).
    const registrationFeeWei = needsRegistration ? await getRegistrationFeeWei(levelId) : 0n;

    // Preflight: ensure user has enough balance for registration ONLY.
    // joinLevel1 is FREE for already-registered users.
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
        toast.loading(label, { id: "join-progress" });
        await approveToken(spender, neededWei);
        return;
      }
      try {
        const allowance = await (publicClient as any).readContract({
          address: USDT_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account as `0x${string}`, spender],
        });
        const allowanceWei = BigInt(allowance || 0);
        console.log("[BlockDetail] allowance", {
          spender,
          allowanceWei: allowanceWei.toString(),
          neededWei: neededWei.toString(),
        });
        if (allowanceWei < neededWei) {
          toast.loading(label, { id: "join-progress" });
          await approveToken(spender, neededWei);
        }
      } catch (err) {
        console.warn("[BlockDetail] allowance read failed, approving defensively:", err);
        toast.loading(label, { id: "join-progress" });
        await approveToken(spender, neededWei);
      }
    };

    // STEP 2: If needed, approve REGISTRY for the registration fee and register.
    if (needsRegistration) {
      await ensureAllowance(registryAddress as `0x${string}`, registrationFeeWei, "Aprobando registro...");
      toast.loading("Registrando usuario on-chain...", { id: "join-progress" });
      await registerUserOnChain(referrerAddress, levelId);
    }

    // NOTE: joinLevel1() is a FREE OPERATION - no additional token transfer.
    // The registration fee already covered the contribution (consolidated flow).
    // Previously we approved the target block here, but that caused a duplicate
    // approve prompt since joinLevel1 doesn't actually pull tokens from the user.

    // STEP 4: Join the block through the Registry
    // V5 function selection:
    // - Level 1: ALWAYS use joinLevel1(member) — auto-resolves from referrer mapping
    // - Level 2+: use joinTargetBlock(member, targetBlock) — for advancement
    // joinTargetBlock reverts with "invalid level" for L1 because it's designed for advancement only.
    const useTargetJoin = levelId > 1;
    const joinFnName = useTargetJoin ? "joinTargetBlock" : "joinLevel1";
    const joinArgs = useTargetJoin
      ? [account as `0x${string}`, blockAddress as `0x${string}`]
      : [account as `0x${string}`];

    toast.loading("Uniéndose al bloque...", { id: "join-progress" });

    // For L1: diagnose what block joinLevel1 will auto-resolve to
    if (!useTargetJoin && publicClient && account) {
      try {
        const onChainReferrer = await (publicClient as any).readContract({
          address: registryAddress,
          abi: REGISTRY_ABI,
          functionName: "referrerOf",
          args: [account as `0x${string}`],
        });
        const refAddr = String(onChainReferrer || "").toLowerCase();
        console.log("[BlockDetail] joinLevel1 will resolve from referrer:", refAddr);
        
        if (refAddr && refAddr !== "0x0000000000000000000000000000000000000000") {
          // Check what block the referrer has at L1
          try {
            const refBlock = await (publicClient as any).readContract({
              address: registryAddress,
              abi: REGISTRY_ABI,
              functionName: "myBlockAtLevel",
              args: [onChainReferrer as `0x${string}`, 1n],
            });
            const refBlockAddr = String(refBlock || "").toLowerCase();
            const targetBlockAddr = blockAddress.toLowerCase();
            console.log("[BlockDetail] Referrer's L1 block:", refBlockAddr, "Target block:", targetBlockAddr);
            
            if (refBlockAddr && refBlockAddr !== "0x0000000000000000000000000000000000000000" && refBlockAddr !== targetBlockAddr) {
              console.warn("[BlockDetail] Mismatch! joinLevel1 will try to join referrer's block, not the one being viewed.");
              // The auto-resolved block is different, but we still proceed — the contract knows best
            }
          } catch (e) {
            console.warn("[BlockDetail] Could not read referrer's block:", e);
          }
        }
      } catch (e) {
        console.warn("[BlockDetail] referrerOf diagnostic failed:", e);
      }
    }

    // Pre-simulate to surface the real revert reason (and avoid burning gas)
    if (publicClient && account) {
      try {
        console.log(`[BlockDetail] Simulating ${joinFnName}...`, { registry: registryAddress, member: account, blockAddress, levelId });
        await (publicClient as any).simulateContract({
          address: registryAddress,
          abi: REGISTRY_ABI,
          functionName: joinFnName,
          args: joinArgs,
          account: account as `0x${string}`,
          chain: chain as any,
        });
        console.log(`[BlockDetail] ${joinFnName} simulation passed`);
      } catch (err) {
        const msg = getViemErrorMessage(err);
        console.error(`[BlockDetail] ${joinFnName} simulation failed:`, msg, err);
        // Dismiss toast before throwing
        toast.dismiss("join-progress");
        // Provide clearer hints for common failure modes
        const msgLower = String(msg).toLowerCase();
        if (msgLower.includes("member not l1") || msgLower.includes("not level 1")) {
          throw new Error(
            "No puedes unirte a este bloque porque tu nivel on-chain no es 1. " +
              "Puede que ya hayas avanzado a un nivel superior.",
          );
        }
        if (msgLower.includes("already member") || msgLower.includes("already has block") || msgLower.includes("already joined")) {
          throw new Error("Ya eres miembro de este bloque o ya tienes un bloque en este nivel.");
        }
        if (msgLower.includes("only registry")) {
          throw new Error("Este bloque pertenece a un registro diferente y no es compatible con el actual.");
        }
        if (msgLower.includes("block full") || msgLower.includes("no slots")) {
          throw new Error("Este bloque ya está lleno.");
        }
        if (msgLower.includes("not active") || msgLower.includes("invalid block")) {
          // For L1: the auto-resolved referrer block may not be active
          throw new Error(
            "El bloque que el contrato resuelve automáticamente (del referido) no está activo. " +
              "Esto puede ocurrir si el bloque del referido ya se completó o cambió de estado.",
          );
        }
        if (msgLower.includes("invalid level")) {
          throw new Error(
            "Nivel inválido para esta operación. " +
              "Si ya estás registrado en Nivel 1, el contrato usa joinLevel1 que resuelve el bloque automáticamente.",
          );
        }
        if (msgLower.includes("allowance") || msgLower.includes("insufficient")) {
          throw new Error("Allowance insuficiente. Por favor, re-intenta el proceso.");
        }
        throw new Error(`No se pudo unir al bloque. Detalle: ${msg}`);
      }
    }

    console.log(`[BlockDetail] Sending ${joinFnName} transaction...`);
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: joinFnName,
      args: joinArgs,
      account: account as `0x${string}`,
      chain: chain as any,
      gas: BigInt(5_000_000),
    });
    const joinReceipt = await waitForTx(txHash);
    
    // Dismiss the "joining" toast now that on-chain join is confirmed
    toast.dismiss("join-progress");

    // Extract the member's personal block address from MyBlockCreated event
    // joinLevel1 automatically creates the member's personal block
    let myBlockAddress: string | null = null;
    for (const log of joinReceipt.logs as any[]) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: REGISTRY_ABI as any,
          data: log.data,
          topics: log.topics,
        }) as any;
        if (decoded?.eventName === "MyBlockCreated" && decoded?.args?.center?.toLowerCase() === account?.toLowerCase()) {
          myBlockAddress = decoded?.args?.blockAddress as string;
          console.log("[BlockDetail] Found MyBlockCreated in joinLevel1, member block:", myBlockAddress);
          break;
        }
      } catch {
        // ignore non-matching logs
      }
    }

    // STEP 5: Disperse registration fee (10% to SocCoop) via PayoutModule
    // This is a best-effort call - the join already succeeded on-chain
    // Use shorter timeout and graceful handling for flaky networks
    const disperseToastId = toast.loading("Dispersando comisión SocCoop (10%)...", { id: "disperse-progress" });
    try {
      console.log("[BlockDetail] Calling disperseRegistrationFee for user:", account, "level:", levelId);

      const disperseTxHash = await writeContractAsync({
        address: CONTRACTS.PAYOUT_MODULE as `0x${string}`,
        abi: PAYOUT_MODULE_ABI as any,
        functionName: "disperseRegistrationFee",
        args: [account as `0x${string}`, BigInt(levelId)],
        account: account as `0x${string}`,
        chain: chain as any,
        gas: BigInt(200_000),
      });

      console.log("[BlockDetail] disperseRegistrationFee tx sent:", disperseTxHash);
      toast.loading("Confirmando dispersión SocCoop...", { id: disperseToastId });

      // Use withTimeout to prevent hanging on network issues
      try {
        const disperseReceipt = await withTimeout(
          publicClient!.waitForTransactionReceipt({ hash: disperseTxHash, timeout: 60_000 }),
          65_000,
          "Timeout esperando confirmación de dispersión SocCoop",
        );
        if (disperseReceipt.status === "success") {
          console.log("[BlockDetail] disperseRegistrationFee confirmed:", disperseTxHash);
          toast.success("Dispersión SocCoop completada", { id: disperseToastId });
        } else {
          console.warn("[BlockDetail] disperseRegistrationFee failed on-chain");
          toast.dismiss(disperseToastId);
        }
      } catch (receiptErr) {
        // Transaction was sent but confirmation timed out - likely succeeded
        console.warn(
          "[BlockDetail] disperseRegistrationFee confirmation timeout, tx may have succeeded:",
          disperseTxHash,
          receiptErr,
        );
        toast.dismiss(disperseToastId);
      }
    } catch (err) {
      // Log but don't fail the join flow - the on-chain join already succeeded
      console.warn("[BlockDetail] disperseRegistrationFee call failed:", err);
      toast.dismiss(disperseToastId);
    }

    return { txHash, myBlockAddress };
  };

  // Create user's personal block (for after joining another block)
  const createPersonalBlock = async (referrerWallet?: string): Promise<{ blockAddress: string; txHash: string }> => {
    // Check if user is registered on-chain first
    const currentLevel = await checkUserLevel();

    // If user is not registered (level = 0), register them first
    if (currentLevel === BigInt(0)) {
      const referrerAddress = referrerWallet
        ? (referrerWallet as `0x${string}`)
        : ("0x0000000000000000000000000000000000000000" as `0x${string}`);

      const registrationFeeWei = await getRegistrationFeeWei(1);
      if (registrationFeeWei > 0n) {
        await approveToken(CONTRACTS.REGISTRY as `0x${string}`, registrationFeeWei);
      }
      await registerUserOnChain(referrerAddress, 1);
    }

    // Using new Registry: createMyBlock(center)
    const txHash = await writeContractAsync({
      address: registryAddress,
      abi: REGISTRY_ABI as any,
      functionName: "createMyBlock",
      args: [account as `0x${string}`],
      account: account as `0x${string}`,
      chain: chain as any,
      gas: BigInt(5_000_000),
    });

    if (!publicClient) throw new Error("Cliente público no disponible");
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
        if (decoded?.eventName === "MyBlockCreated") {
          blockAddress = decoded?.args?.blockAddress as `0x${string}`;
          break;
        }
      } catch {
        // ignore non-matching logs
      }
    }

    if (!blockAddress) {
      throw new Error("No se pudo obtener la dirección del bloque creado");
    }

    return { blockAddress, txHash };
  };

  const connectWallet = () => openAppKit();

  const [block, setBlock] = useState<BlockDetails | null>(null);
  const [members, setMembers] = useState<BlockMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  // Wallet del usuario usada para ESTE bloque (no necesariamente la primaria)
  const [userWallet, setUserWallet] = useState<{ id: string; wallet_address: string } | null>(
    null,
  );
  // On-chain referral code for sharing links
  const [onChainRefCode, setOnChainRefCode] = useState<string | null>(null);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);
  const [isBlockCreator, setIsBlockCreator] = useState(false);
  const [accumulatedContributions, setAccumulatedContributions] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [nextLevel, setNextLevel] = useState<NextLevelInfo | null>(null);
  const [hasClaimedBlock, setHasClaimedBlock] = useState(false);
  // Track if user needs to start at L1 (when visiting L2+ block as new user)
  const [needsL1First, setNeedsL1First] = useState(false);
  const [referrerWalletCode, setReferrerWalletCode] = useState<string | null>(null);
  const [level1ContributionAmount, setLevel1ContributionAmount] = useState<number>(20);
  // Track if user is already registered on-chain (level >= 1) so joinLevel1 is FREE
  const [isRegisteredOnChain, setIsRegisteredOnChain] = useState(false);

  const refCode = searchParams.get("ref");

  useEffect(() => {
    if (blockId) {
      loadBlockDetails();
    }
  }, [blockId, user]);

  // Auto-refresh block details every 15 seconds
  const autoRefreshBlock = useCallback(() => {
    if (blockId && !isJoining) loadBlockDetails(true);
  }, [blockId, user, account, publicClient, isJoining]);
  useAutoRefresh(autoRefreshBlock, 15000, !!blockId);

  // Check on-chain registration status when account changes
  // If user is already registered (level >= 1), joinLevel1 is FREE
  useEffect(() => {
    if (!account || !publicClient) {
      setIsRegisteredOnChain(false);
      return;
    }
    (async () => {
      try {
        const level = await checkUserLevel();
        setIsRegisteredOnChain(level >= 1n);
        console.log("[BlockDetail] On-chain level check:", level.toString(), "isRegistered:", level >= 1n);
      } catch {
        setIsRegisteredOnChain(false);
      }
    })();
  }, [account, publicClient]);

  // IMPORTANT (multi-wallet): for non-creators, the “active” wallet for joining must be the
  // currently connected address. If the user switches wallets, we must update membership state
  // and the referral code context accordingly.
  useEffect(() => {
    if (!user || !block) return;

    // Creators use the block-specific wallet context (creator_wallet_address) for owner-only actions.
    if (block.creator_id === user.id) return;

    const accountLower = account?.toLowerCase();
    if (!accountLower) {
      setUserWallet(null);
      setIsAlreadyMember(false);
      return;
    }

    // Membership check should follow the CONNECTED account, not a previously loaded wallet.
    const isMemberNow = members.some(
      (m) => (m.user_wallets?.wallet_address || "").toLowerCase() === accountLower,
    );
    setIsAlreadyMember(isMemberNow);

    // Keep `userWallet` aligned to the connected wallet so referral links and wallet-scoped
    // checks are consistent when the user switches accounts.
    (async () => {
      const { data } = await supabase
        .from("user_wallets")
        .select("id, wallet_address")
        .eq("user_id", user.id)
        .ilike("wallet_address", accountLower)
        .maybeSingle();

      setUserWallet(data ?? null);
    })();
  }, [account, user, block, members]);

  // Fetch on-chain referral code for sharing links
  useEffect(() => {
    if (!account || !publicClient) {
      setOnChainRefCode(null);
      return;
    }
    (async () => {
      try {
        const code = await readReferralCode(publicClient, account as `0x${string}`);
        setOnChainRefCode(code);
      } catch {
        setOnChainRefCode(null);
      }
    })();
  }, [account, publicClient]);

  const loadBlockDetails = async (silent = false) => {
    try {
       const isContractAddress = blockId?.startsWith('0x');
       
       if (!isContractAddress) {
         // UUID block lookups are no longer supported - data lives on-chain only
         console.warn('[BlockDetail] UUID block lookups not supported, use contract address');
          if (!silent) setLoading(false);
         return;
       }

       // Load block data directly from on-chain
       console.log('[BlockDetail] Loading block from on-chain:', blockId);
       const snapshot = await readBlockSnapshot(blockId as `0x${string}`);
         if (snapshot) {
           // Determine level from contribution amount
            // Use USDT_DECIMALS (6) to avoid issues when token decimals haven't loaded yet
            const contributionUSDT = Number(formatUnits(snapshot.contributionAmount, USDT_DECIMALS));
           let levelId = 1;
           let levelName = 'Curioso';
            let requiredMembers = 9;
            let totalCundina = 180;
           
            // Map contribution amounts to levels (V5 nomenclature)
            if (contributionUSDT >= 2500) { levelId = 7; levelName = 'Leyenda'; requiredMembers = 3; totalCundina = 7500; }
            else if (contributionUSDT >= 1000) { levelId = 6; levelName = 'Maestro'; requiredMembers = 4; totalCundina = 4000; }
            else if (contributionUSDT >= 500) { levelId = 5; levelName = 'Asesor'; requiredMembers = 5; totalCundina = 2500; }
            else if (contributionUSDT >= 250) { levelId = 4; levelName = 'Aprendiz'; requiredMembers = 6; totalCundina = 1500; }
            else if (contributionUSDT >= 100) { levelId = 3; levelName = 'Novato'; requiredMembers = 7; totalCundina = 700; }
            else if (contributionUSDT >= 50) { levelId = 2; levelName = 'Soñador'; requiredMembers = 8; totalCundina = 400; }
           
            // Get consecutive block number from Subgraph
            const blockNum = await getBlockNumber(blockId!, levelId);
            
            const onChainBlock: BlockDetails = {
              id: blockId!,
              block_number: blockNum ?? 1,
              level_block_number: blockNum ?? 1,
             level_id: levelId,
             current_members: Number(snapshot.membersCount),
             status: snapshot.status === 0n ? 'active' : 'completed',
             contract_address: blockId!.toLowerCase(),
             creator_wallet_address: snapshot.owner.toLowerCase(),
             creator_id: '', // Unknown from on-chain
             levels: {
               name: levelName,
               contribution_amount: contributionUSDT,
               total_cundina: totalCundina,
               required_members: requiredMembers,
             }
           };
           
           setBlock(onChainBlock);
           setAccumulatedContributions(Number(snapshot.membersCount) * contributionUSDT * 0.9);
           
           // Check if current user is creator (on-chain owner check)
           const isCreatorOnChain = account && snapshot.owner.toLowerCase() === account.toLowerCase();
           if (isCreatorOnChain) {
             setIsBlockCreator(true);
             setIsAlreadyMember(true); // Creators are treated as members
           }
           
             // Load members from Subgraph (primary) with RPC fallback
             try {
               let membersData: BlockMember[] = [];
               let ownerReferralCode: string | null = null;

               // Try Subgraph first
               try {
                 const sgResult = await querySubgraph<BlockDetailsQueryResult>(BLOCK_DETAILS_QUERY, {
                   blockId: blockId!.toLowerCase(),
                 });
                 if (sgResult.block?.members?.length) {
                   membersData = sgResult.block.members.map((m: any) => ({
                     id: m.id,
                     position: m.position,
                     user_wallets: { wallet_address: m.member.id },
                   }));
                   ownerReferralCode = sgResult.block.owner?.referralCode || null;
                 }
               } catch (sgErr) {
                 console.warn('[BlockDetail] Subgraph query failed, falling back to RPC:', sgErr);
               }

               // Fallback: read members directly from contract via RPC
               if (!membersData.length && publicClient) {
                 try {
                   const onChainMembers = await (publicClient as any).readContract({
                     address: blockId as `0x${string}`,
                     abi: BLOCK_INFO_ABI,
                     functionName: "getMembers",
                   });
                   if (Array.isArray(onChainMembers)) {
                     membersData = onChainMembers.map((addr: string, idx: number) => ({
                       id: `rpc-${idx}`,
                       position: idx + 1,
                       user_wallets: { wallet_address: addr.toLowerCase() },
                     }));
                   }
                 } catch (rpcErr) {
                   console.warn('[BlockDetail] RPC getMembers failed:', rpcErr);
                 }
               }

                // Sort by position (join order) to ensure consistent display
                membersData.sort((a, b) => a.position - b.position);
                setMembers(membersData);

               if (ownerReferralCode) {
                 // Convert subgraph bytes to uppercase hex without 0x prefix
                 const code = ownerReferralCode.startsWith('0x')
                   ? ownerReferralCode.slice(2).toUpperCase()
                   : ownerReferralCode.toUpperCase();
                 setReferrerWalletCode(code);
               }

               // Check if current user is a member
               if (account && !isCreatorOnChain) {
                 const isMember = membersData.some(
                   (m) => m.user_wallets?.wallet_address?.toLowerCase() === account.toLowerCase()
                 );
                 setIsAlreadyMember(isMember);
               }
             } catch (err) {
               console.error('[BlockDetail] Error loading members:', err);
               setMembers([]);
             }
            
            // FOR ON-CHAIN BLOCKS: Check if block is completed and show modal for creator
            const isBlockCompletedOnChain = 
              snapshot.status !== 0n || // status != Active means completed
              (snapshot.requiredMembers > 0n && snapshot.membersCount >= snapshot.requiredMembers);
            
            if (isCreatorOnChain && isBlockCompletedOnChain) {
              // Check if user has already claimed (look for next level block on-chain)
              let alreadyClaimed = false;
              
              if (user && publicClient) {
                try {
                  // Check if user has a block at next level via Registry
                  const nextLevelBlock = await (publicClient as any).readContract({
                    address: registryAddress,
                    abi: REGISTRY_ABI,
                    functionName: "myBlockAtLevel",
                    args: [account as `0x${string}`, BigInt(levelId + 1)],
                  });
                  
                  // If there's a block at next level, user has already advanced
                  if (nextLevelBlock && nextLevelBlock !== "0x0000000000000000000000000000000000000000") {
                    alreadyClaimed = true;
                  }
                } catch (err) {
                  console.warn("[BlockDetail] Error checking next level block:", err);
                }
                
                // Advance claim check is done entirely on-chain via myBlockAtLevel above
              }
              
              setHasClaimedBlock(alreadyClaimed);
              
            if (!alreadyClaimed) {
                console.log("[BlockDetail] On-chain block completed, showing modal for creator");
                setShowCompletionModal(true);
              }
            }
            
            // Load next level info for on-chain blocks
            const { data: nextLevelData } = await supabase
              .from("levels")
              .select("id, name, contribution_amount")
              .eq("id", levelId + 1)
              .maybeSingle();
            
            setNextLevel(nextLevelData);
            
            if (!silent) setLoading(false);
           return;
          }

       // Block not found on-chain
       if (!silent) setLoading(false);
    } catch (error) {
      console.error("Error loading block:", error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleJoinBlock = async () => {
    if (!user || !block) {
      toast.error("Debes iniciar sesión para unirte");
      return;
    }

    if (!account) {
      toast.error("Conecta tu billetera primero");
      connectWallet();
      return;
    }

    // CRITICAL: Prevent creator from joining their own block with any wallet
    if (block.creator_id === user.id) {
      toast.error("No puedes unirte a tu propio bloque");
      return;
    }

    // Also check if connected wallet is the creator's wallet
    if (block.creator_wallet_address?.toLowerCase() === account.toLowerCase()) {
      toast.error("Esta wallet es la creadora del bloque. No puedes unirte a tu propio bloque.");
      return;
    }

    // Check if user has a wallet registered with the CONNECTED address.
    // NOTE: `userWallet` can be set for other purposes (e.g. creator context) so we must
    // only reuse it when it matches the connected account.
    const accountLower = account.toLowerCase();
    let walletToUse =
      userWallet && userWallet.wallet_address?.toLowerCase() === accountLower ? userWallet : null;

    if (!walletToUse) {
      // Try to find or create wallet for the connected account
      const { data: existingWallet } = await supabase
        .from("user_wallets")
        .select("id, wallet_address")
        .eq("user_id", user.id)
        .ilike("wallet_address", accountLower)
        .maybeSingle();

      if (existingWallet) {
        walletToUse = existingWallet;
        setUserWallet(existingWallet);
      } else {
        // Check if wallet exists for another user
        const { data: otherWallet } = await supabase
          .from("user_wallets")
          .select("id, user_id")
          .ilike("wallet_address", accountLower)
          .maybeSingle();

        if (otherWallet && otherWallet.user_id !== user.id) {
          toast.error("Esta wallet está registrada en otra cuenta");
          return;
        }

        // Create new wallet for user with referral from block creator
        const { data: newWallet, error: walletError } = await supabase
          .from("user_wallets")
          .insert({
            user_id: user.id,
            wallet_address: accountLower,
            // NOTE: referral chain is tracked on-chain via Registry.referrerOf mapping
          })
          .select("id, wallet_address")
          .single();

        if (walletError) {
          console.error("Error creating wallet:", walletError);
          toast.error("Error al registrar tu wallet");
          return;
        }
        walletToUse = newWallet;
        setUserWallet(newWallet);
      }
    }

    if (!walletToUse) {
      toast.error("No se pudo resolver la wallet para esta sesión");
      return;
    }

    const balanceNum = parseFloat(balance);
    const contributionAmount = block.levels.contribution_amount;

    // Only check balance if user is NOT registered on-chain yet
    // joinLevel1 is FREE for registered users (level >= 1)
    if (!isRegisteredOnChain && balanceNum < contributionAmount) {
      toast.error(`Balance insuficiente. Necesitas ${contributionAmount} USDT para el registro`);
      return;
    }

    if (!block.contract_address) {
      toast.error("El bloque no tiene contrato desplegado");
      return;
    }

    setIsJoining(true);
    const toastId = toast.loading("Procesando...");

    try {
      // Step 1: Join block on blockchain using Registry.joinLevel1 (includes auto-registration if needed)
      toast.loading("Uniéndose al bloque...", { id: toastId });
      const referrerWallet = block.creator_wallet_address || undefined;
      const { txHash, myBlockAddress: newBlockFromJoin } = await joinBlockOnChain(
        block.contract_address,
        contributionAmount.toString(),
        referrerWallet,
        block.level_id,
      );

      // NOTE: Block membership, transactions, and level progress are now tracked
      // entirely on-chain and indexed by the Subgraph. No database sync needed.

      // Step 6: Create notifications
      await supabase.from("notifications").insert({
        user_id: user.id,
        title: "¡Te uniste al Bloque!",
        message: `Te has unido al Bloque #${block.level_block_number ?? block.block_number}`,
        type: "success",
      });

      // Notify the block creator that a new member joined
      if (block.creator_id && block.creator_id !== user.id) {
        await supabase.from("notifications").insert({
          user_id: block.creator_id,
          title: "¡Nuevo miembro!",
          message: `Un nuevo miembro se ha unido a tu Bloque #${block.level_block_number ?? block.block_number}`,
          type: "info",
        });
      }

      toast.success("¡Te uniste al bloque y se creó tu propio bloque!", { id: toastId });
      loadBlockDetails(); // Refresh data
    } catch (error: any) {
      console.error("Join block error:", error);
      toast.error(error.message || "Error al unirse al bloque", { id: toastId });
    } finally {
      setIsJoining(false);
    }
  };

  // Handle L2+ block participation: register at L1 (20 USDT), count as participant/vote for L2+ block
  // Members of L2+ blocks only come through the advance flow
  const handleParticipateL2 = async () => {
    if (!user || !block) {
      toast.error("Debes iniciar sesión para participar");
      return;
    }
    if (!account) {
      toast.error("Conecta tu billetera primero");
      connectWallet();
      return;
    }
    if (block.creator_wallet_address?.toLowerCase() === account.toLowerCase()) {
      toast.error("No puedes participar en tu propio bloque");
      return;
    }

    const currentLevel = await checkUserLevel();
    if (currentLevel > 0n) {
      toast.info("Ya estás registrado on-chain. Tu voto ya fue contado.");
      setIsRegisteredOnChain(true);
      return;
    }

    const accountLower = account.toLowerCase();
    let walletToUse =
      userWallet && userWallet.wallet_address?.toLowerCase() === accountLower ? userWallet : null;

    if (!walletToUse) {
      const { data: existingWallet } = await supabase
        .from("user_wallets")
        .select("id, wallet_address")
        .eq("user_id", user.id)
        .ilike("wallet_address", accountLower)
        .maybeSingle();

      if (existingWallet) {
        walletToUse = existingWallet;
        setUserWallet(existingWallet);
      } else {
        const { data: otherWallet } = await supabase
          .from("user_wallets")
          .select("id, user_id")
          .ilike("wallet_address", accountLower)
          .maybeSingle();

        if (otherWallet && otherWallet.user_id !== user.id) {
          toast.error("Esta wallet está registrada en otra cuenta");
          return;
        }

        const { data: newWallet, error: walletError } = await supabase
          .from("user_wallets")
          .insert({ user_id: user.id, wallet_address: accountLower })
          .select("id, wallet_address")
          .single();

        if (walletError) {
          toast.error("Error al registrar tu wallet");
          return;
        }
        walletToUse = newWallet;
        setUserWallet(newWallet);
      }
    }

    setIsJoining(true);
    const toastId = toast.loading("Procesando participación...");

    try {
      const registrationFeeWei = await getRegistrationFeeWei(1);
      const balanceWei = await getTokenBalanceWei();
      if (balanceWei < registrationFeeWei) {
        throw new Error(`Balance insuficiente. Necesitas ${level1ContributionAmount} USDT para registrarte.`);
      }

      if (publicClient && account) {
        try {
          const allowance = await (publicClient as any).readContract({
            address: USDT_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [account as `0x${string}`, registryAddress as `0x${string}`],
          });
          if (BigInt(allowance || 0) < registrationFeeWei) {
            toast.loading("Aprobando registro...", { id: toastId });
            await approveToken(registryAddress as `0x${string}`, registrationFeeWei);
          }
        } catch {
          toast.loading("Aprobando registro...", { id: toastId });
          await approveToken(registryAddress as `0x${string}`, registrationFeeWei);
        }
      }

      toast.loading("Registrando on-chain...", { id: toastId });
      const referrerAddress = (block.creator_wallet_address ||
        "0x0000000000000000000000000000000000000000") as `0x${string}`;

      const txHash = await writeContractAsync({
        address: registryAddress,
        abi: REGISTRY_ABI as any,
        functionName: "registerAndCreateBlock",
        args: [account as `0x${string}`, referrerAddress, 1n],
        account: account as `0x${string}`,
        chain: chain as any,
        gas: 1_000_000n,
      });
      const receipt = await waitForTx(txHash);

      let myBlockAddress: string | null = null;
      for (const log of receipt.logs as any[]) {
        if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: REGISTRY_ABI as any,
            data: log.data,
            topics: log.topics,
          }) as any;
          if (
            decoded?.eventName === "MyBlockCreated" &&
            decoded?.args?.center?.toLowerCase() === account.toLowerCase()
          ) {
            myBlockAddress = decoded?.args?.blockAddress as string;
            break;
          }
        } catch { /* ignore */ }
      }

      // NOTE: Block data, transactions, and level progress are now tracked
      // entirely on-chain and indexed by the Subgraph. No database sync needed.

      try {
        const disperseTxHash = await writeContractAsync({
          address: CONTRACTS.PAYOUT_MODULE as `0x${string}`,
          abi: PAYOUT_MODULE_ABI as any,
          functionName: "disperseRegistrationFee",
          args: [account as `0x${string}`, 1n],
          account: account as `0x${string}`,
          chain: chain as any,
          gas: 200_000n,
        });
        await withTimeout(
          publicClient!.waitForTransactionReceipt({ hash: disperseTxHash, timeout: 60_000 }),
          65_000,
          "Timeout dispersión SocCoop",
        );
      } catch (err) {
        console.warn("[BlockDetail] disperseRegistrationFee failed:", err);
      }

      await supabase.from("notifications").insert({
        user_id: user.id,
        title: "¡Participación registrada!",
        message: `Te registraste como participante del Bloque Nivel ${block.level_id}. Tu bloque Nivel 1 está activo.`,
        type: "success",
      });

      if (block.creator_id && block.creator_id !== user.id) {
        await supabase.from("notifications").insert({
          user_id: block.creator_id,
          title: "¡Nuevo participante!",
          message: `Un nuevo participante se registró en tu Bloque Nivel ${block.level_id}`,
          type: "info",
        });
      }

      toast.success("¡Registrado! Tu bloque Nivel 1 está activo y tu voto cuenta.", { id: toastId });
      setNeedsL1First(false);
      setIsRegisteredOnChain(true);
      loadBlockDetails();
    } catch (error: any) {
      console.error("Participate L2 error:", error);
      toast.error(error.message || "Error al participar", { id: toastId });
    } finally {
      setIsJoining(false);
    }
  };

  // Guest or unauthenticated user registration flow
  // For authenticated users, this will redirect to connect to get wallet connected
  const handleGuestRegister = () => {
    const codeToUse = refCode || referrerWalletCode;

    // Store the referral code
    if (codeToUse) {
      localStorage.setItem("referralCode", codeToUse);
    }

    // After login/registration, bring the user back to this block invitation
    if (blockId) {
      const redirectTo = codeToUse ? `/block/${blockId}?ref=${codeToUse}` : `/block/${blockId}`;
      localStorage.setItem("postAuthRedirect", redirectTo);

      // Persist referral source context explicitly (postAuthRedirect is cleared by /connect)
      localStorage.setItem("referrerSourceBlockId", blockId);
      if (block?.creator_wallet_address)
        localStorage.setItem("referrerSourceWalletAddress", block.creator_wallet_address);
    }

    // Redirect to connect page for wallet-first flow (or auth for email)
    const connectUrl = codeToUse ? `/connect?ref=${codeToUse}` : "/connect";
    navigate(connectUrl);
  };

  // Handle starting L1 flow for authenticated users who need to connect wallet or create L1
  const handleStartL1Flow = () => {
    const codeToUse = refCode || referrerWalletCode;

    if (codeToUse) {
      localStorage.setItem("referralCode", codeToUse);
    }

    // Store current block as return destination after completing L1
    if (blockId) {
      const redirectTo = codeToUse ? `/block/${blockId}?ref=${codeToUse}` : `/block/${blockId}`;
      localStorage.setItem("postAuthRedirect", redirectTo);

      // Persist referral source context explicitly (postAuthRedirect can be cleared by /connect)
      localStorage.setItem("referrerSourceBlockId", blockId);
      if (block?.creator_wallet_address)
        localStorage.setItem("referrerSourceWalletAddress", block.creator_wallet_address);
    }

    // Navigate to dashboard where user can create their L1 block
    // The Dashboard has PaymentCard component to handle L1 creation with referral
    navigate(`/dashboard?ref=${codeToUse || ""}`);
  };

  const getReferralLink = () => {
    const baseUrl = window.location.origin;
    const walletRef = onChainRefCode || "";
    return `${baseUrl}/block/${blockId}?ref=${walletRef}`;
  };

  const handleCopyReferralLink = async () => {
    try {
      await navigator.clipboard.writeText(getReferralLink());
      setCopied(true);
      toast.success("Link copiado al portapapeles");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Error al copiar el link");
    }
  };

  const handleShareReferralLink = async () => {
    const link = getReferralLink();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Únete a mi Bloque #${block?.level_block_number ?? block?.block_number}`,
          text: `¡Únete a mi bloque y gana ${block?.levels.total_cundina} USDT!`,
          url: link,
        });
      } catch {
        handleCopyReferralLink();
      }
    } else {
      handleCopyReferralLink();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pb-24 flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!block) {
    return (
      <div className="min-h-screen pb-24 bg-background">
        <Navigation />
        <div className="container mx-auto px-4 pt-32 text-center">
          <h2 className="text-xl font-bold mb-2">Bloque no encontrado</h2>
          <p className="text-muted-foreground mb-4">Este bloque no existe o ha sido eliminado.</p>
          <Button onClick={() => navigate("/")}>Volver al inicio</Button>
        </div>
      </div>
    );
  }

  const totalPot = block.levels.total_cundina;
  const myContribution = block.levels.contribution_amount;
  const pendingToCollect = totalPot - accumulatedContributions;
  const spotsAvailable = block.levels.required_members - block.current_members;
  const isGuest = !user;

  return (
    <div className="min-h-screen pb-24 bg-background">
      <Navigation />

      <div className="bg-header text-header-foreground p-4 fixed top-16 left-0 right-0 z-10">
        <div className="container mx-auto flex items-center gap-4">
          <button onClick={() => navigate(-1)}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          {isGuest && <span className="text-sm">Invitación al Bloque</span>}
        </div>
      </div>

      <div className="container mx-auto px-4 pt-32">
        {/* Guest Invitation Banner */}
        {isGuest && spotsAvailable > 0 && (
          <Card className="p-4 bg-primary/10 border-primary/30 rounded-xl mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-full">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">¡Te han invitado!</p>
                <p className="text-sm text-muted-foreground">
                  {spotsAvailable === 1 ? "Queda 1 lugar disponible" : `Quedan ${spotsAvailable} lugares disponibles`}
                </p>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-6 bg-card text-card-foreground rounded-2xl mb-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Bloque #{block.level_block_number ?? block.block_number}</h2>
              <div
                className={`flex items-center gap-2 text-sm px-3 py-1 rounded-full ${
                  block.status === "active"
                    ? "bg-success/20 text-success"
                    : block.status === "completed"
                      ? "bg-info/20 text-info"
                      : "bg-destructive/20 text-destructive"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    block.status === "active"
                      ? "bg-success"
                      : block.status === "completed"
                        ? "bg-info"
                        : "bg-destructive"
                  }`}
                ></div>
                {block.status === "active" ? "Activo" : block.status === "completed" ? "Completado" : "Cancelado"}
              </div>
            </div>

            {/* Level Info */}
            <div className="bg-muted/30 rounded-xl p-4">
              <p className="text-sm text-muted-foreground mb-1">Nivel</p>
              <p className="text-xl font-bold">{block.levels.name}</p>
            </div>

            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {needsL1First && block.level_id > 1 ? "Tu aporte inicial (Nivel 1)" : "Aporte por miembro"}
              </p>
              <p className="text-3xl font-bold text-success">
                {needsL1First && block.level_id > 1 ? level1ContributionAmount : block.levels.contribution_amount} USDT
              </p>
            </div>

            <div className="flex items-center justify-between py-4 border-t border-b border-border">
              <Users className="w-5 h-5 text-primary" />
              <span className="text-sm text-muted-foreground">Miembros</span>
              <span className="text-xl font-bold">
                {block.current_members}/{block.levels.required_members}
              </span>
            </div>

            {/* Creator Section */}
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 mb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                    <span className="text-xs font-bold text-primary">C</span>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Creador del Bloque</p>
                    <p className="text-sm font-mono">
                      {block.creator_wallet_address
                        ? `${block.creator_wallet_address.slice(0, 6)}...${block.creator_wallet_address.slice(-4)}`
                        : "Sin wallet"}
                    </p>
                  </div>
                </div>
                <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-full">Organizador</span>
              </div>
            </div>

            {/* Members List */}
            <div className="space-y-2 bg-card-dark rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-2">
                Miembros ({block.current_members}/{block.levels.required_members})
              </p>
              {members.map((member, idx) => {
                const walletAddr = member.user_wallets?.wallet_address;
                const displayAddr = walletAddr ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}` : "—";
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-success/20 rounded-full flex items-center justify-center">
                        <span className="text-xs font-bold text-success">{idx + 1}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">Miembro</span>
                    </div>
                    <span className="text-sm font-mono text-foreground">{displayAddr}</span>
                  </div>
                );
              })}
              {Array.from({ length: block.levels.required_members - members.length }).map((_, idx) => (
                <div
                  key={`empty-${idx}`}
                  className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 opacity-30"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-muted rounded-full flex items-center justify-center">
                      <span className="text-xs">{members.length + idx + 1}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Vacante</span>
                  </div>
                  <span className="text-sm">—</span>
                </div>
              ))}
            </div>

            {/* Guest CTA */}
            {isGuest ? (
              <div className="pt-4 space-y-4">
                {needsL1First && block.level_id > 1 ? (
                  /* L2+ block visited by new user - show L1 registration flow */
                  <>
                    <div className="text-center">
                      <h3 className="text-lg font-bold mb-2">¡Te han invitado a participar!</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Para llegar al Nivel {block.level_id}, primero debes completar el Nivel 1. Regístrate ahora y
                        comienza tu camino.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-center mb-4">
                      <div className="bg-muted/30 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-1">Ganarás en Nivel 1</p>
                        <p className="text-xl font-bold text-success">162 USDT</p>
                      </div>
                      <div className="bg-muted/30 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-1">Tu aporte inicial</p>
                        <p className="text-xl font-bold text-primary">{level1ContributionAmount} USDT</p>
                      </div>
                    </div>

                    <div className="bg-info/10 border border-info/30 rounded-xl p-3 mb-4">
                      <p className="text-xs text-info text-center">
                        Al registrarte, tu participación contará para el creador de este bloque Nivel {block.level_id}
                      </p>
                    </div>

                    <Button
                      onClick={handleGuestRegister}
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-12"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Participar por {level1ContributionAmount} USDT
                    </Button>
                  </>
                ) : (
                  /* Regular L1 block or eligible user */
                  <>
                    <div className="text-center">
                      <h3 className="text-lg font-bold mb-2">Únete a este bloque</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Regístrate para unirte y comenzar a ganar con este bloque
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-center mb-4">
                      <div className="bg-muted/30 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-1">Ganarás al completar</p>
                        <p className="text-xl font-bold text-success">{block.levels.total_cundina} USDT</p>
                      </div>
                      <div className="bg-muted/30 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-1">Tu aporte</p>
                        <p className="text-xl font-bold text-primary">{block.levels.contribution_amount} USDT</p>
                      </div>
                    </div>

                    <Button
                      onClick={handleGuestRegister}
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-12"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Registrarme y Unirme
                    </Button>
                  </>
                )}
              </div>
            ) : (
              /* Authenticated User View */
              <div className="pt-4">
                {isAlreadyMember ? (
                  isBlockCreator ? (
                    /* Creator View - "Tu decides" section */
                    <>
                      <h3 className="text-lg font-bold mb-4">
                        {hasClaimedBlock ? "Estado del bloque:" : "Tu decides:"}
                      </h3>
                      <div className="grid grid-cols-3 gap-2 text-center mb-4">
                        <div className="bg-muted/30 rounded-xl p-2">
                          <p className="text-xs text-muted-foreground mb-1">Acumulado</p>
                          <p className="text-lg font-bold text-success">{accumulatedContributions.toFixed(0)} USDT</p>
                        </div>
                        <div className="bg-muted/30 rounded-xl p-2">
                          <p className="text-xs text-muted-foreground mb-1">Total meta</p>
                          <p className="text-lg font-bold text-info">{totalPot} USDT</p>
                        </div>
                        <div className="bg-muted/30 rounded-xl p-2">
                          <p className="text-xs text-muted-foreground mb-1">
                            {hasClaimedBlock ? "Estado" : "Pendiente"}
                          </p>
                          {hasClaimedBlock ? (
                            <p className="text-lg font-bold text-success">✓ Reclamado</p>
                          ) : (
                            <p className="text-lg font-bold text-warning">{pendingToCollect.toFixed(0)} USDT</p>
                          )}
                        </div>
                      </div>

                      {hasClaimedBlock ? (
                        <div className="bg-success/10 border border-success/30 rounded-xl p-4 text-center">
                          <Check className="w-8 h-8 text-success mx-auto mb-2" />
                          <h3 className="text-lg font-bold text-success mb-1">¡Bloque reclamado!</h3>
                          <p className="text-sm text-muted-foreground">
                            Ya avanzaste al siguiente nivel o retiraste tus ganancias.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 mb-4">
                            <p className="text-sm font-semibold mb-2">Invita a más miembros</p>
                            <Button
                              onClick={handleShareReferralLink}
                              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                              {copied ? <Check className="w-4 h-4 mr-2" /> : <Share2 className="w-4 h-4 mr-2" />}
                              {copied ? "Link copiado" : "Compartir invitación"}
                            </Button>
                          </div>

                          <Button
                            onClick={spotsAvailable === 0 ? () => setShowCompletionModal(true) : undefined}
                            disabled={spotsAvailable > 0}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-12"
                          >
                            {spotsAvailable > 0
                              ? `${spotsAvailable} miembros pendientes`
                              : "Bloque completo - Ver opciones"}
                          </Button>
                        </>
                      )}
                    </>
                  ) : (
                    /* Member View - No "Tu decides" section */
                    <div className="bg-success/10 border border-success/30 rounded-xl p-4 text-center">
                      <Check className="w-8 h-8 text-success mx-auto mb-2" />
                      <h3 className="text-lg font-bold text-success mb-1">¡Ya eres miembro!</h3>
                      <p className="text-sm text-muted-foreground">
                        Tu aportación está registrada. Espera a que el bloque se complete.
                      </p>
                      <div className="mt-3 text-sm">
                        <span className="text-muted-foreground">Progreso: </span>
                        <span className="font-bold">
                          {block.current_members}/{block.levels.required_members} miembros
                        </span>
                      </div>
                    </div>
                  )
                ) : block.level_id > 1 ? (
                  /* L2+ Block - Participate as voter (members only through advance flow) */
                  <>
                    <div className="text-center">
                      <h3 className="text-lg font-bold mb-2">
                        {isRegisteredOnChain ? "¡Ya eres participante!" : "Participa en este bloque"}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        {isRegisteredOnChain
                          ? "Tu registro ya cuenta como voto. Los miembros solo se suman por avance de nivel."
                          : `Paga ${level1ContributionAmount} USDT para registrarte. Tu aporte cuenta como voto y participación.`}
                      </p>
                    </div>

                    {!isRegisteredOnChain ? (
                      <>
                        <div className="grid grid-cols-2 gap-4 text-center mb-4">
                          <div className="bg-muted/30 rounded-xl p-3">
                            <p className="text-xs text-muted-foreground mb-1">Ganarás en Nivel 1</p>
                            <p className="text-xl font-bold text-success">162 USDT</p>
                          </div>
                          <div className="bg-muted/30 rounded-xl p-3">
                            <p className="text-xs text-muted-foreground mb-1">Tu aporte</p>
                            <p className="text-xl font-bold text-primary">{level1ContributionAmount} USDT</p>
                          </div>
                        </div>

                        <div className="bg-muted/30 rounded-xl p-3 mb-4">
                          {account && (
                            <div className="flex items-center justify-between text-sm mb-2 pb-2 border-b border-border/50">
                              <span className="text-muted-foreground">Wallet conectada:</span>
                              <span className="font-mono text-xs">
                                {account.slice(0, 6)}...{account.slice(-4)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-muted-foreground">Registro requerido:</span>
                            <span className="font-bold text-primary">{level1ContributionAmount} USDT</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Tu balance:</span>
                            <span
                              className={`font-mono font-semibold ${parseFloat(balance) >= level1ContributionAmount ? "text-success" : "text-destructive"}`}
                            >
                              {parseFloat(balance).toFixed(2)} USDT
                            </span>
                          </div>
                        </div>

                        <div className="bg-info/10 border border-info/30 rounded-xl p-3 mb-4">
                          <p className="text-xs text-info text-center">
                            Al registrarte, tu voto contará para el creador de este bloque Nivel {block.level_id}. También se creará tu bloque Nivel 1.
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            onClick={!account ? connectWallet : handleParticipateL2}
                            disabled={isJoining || (!!account && parseFloat(balance) < level1ContributionAmount)}
                            className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-12"
                          >
                            {isJoining ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Procesando...
                              </>
                            ) : !account ? (
                              "Conectar Wallet"
                            ) : (
                              <>
                                <UserPlus className="w-4 h-4 mr-2" />
                                Participar por {level1ContributionAmount} USDT
                              </>
                            )}
                          </Button>
                          {account && (
                            <Button
                              onClick={() => openAppKit()}
                              disabled={isJoining}
                              variant="outline"
                              className="rounded-xl h-12 px-4"
                              title="Cambiar wallet"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="bg-success/10 border border-success/30 rounded-xl p-4 text-center">
                        <Check className="w-8 h-8 text-success mx-auto mb-2" />
                        <h3 className="text-lg font-bold text-success mb-1">¡Ya eres participante!</h3>
                        <p className="text-sm text-muted-foreground">
                          Tu registro on-chain ya cuenta como voto para este bloque.
                        </p>
                      </div>
                    )}
                  </>
                ) : spotsAvailable > 0 && block.status === "active" ? (
                  <>
                    <h3 className="text-lg font-bold mb-2">Únete a este bloque</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {isRegisteredOnChain
                        ? "Ya estás registrado on-chain. Unirte es gratis."
                        : `Aporta ${block.levels.contribution_amount} USDT para unirte`}
                    </p>

                    <div className="bg-muted/30 rounded-xl p-3 mb-4">
                      {account && (
                        <div className="flex items-center justify-between text-sm mb-2 pb-2 border-b border-border/50">
                          <span className="text-muted-foreground">Wallet conectada:</span>
                          <span className="font-mono text-xs">
                            {account.slice(0, 6)}...{account.slice(-4)}
                          </span>
                        </div>
                      )}
                      {isRegisteredOnChain ? (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Estado:</span>
                          <span className="font-semibold text-success">✓ Registrado on-chain</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-muted-foreground">Aporte requerido:</span>
                            <span className="font-bold text-primary">{block.levels.contribution_amount} USDT</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Tu balance:</span>
                            <span
                              className={`font-mono font-semibold ${parseFloat(balance) >= block.levels.contribution_amount ? "text-success" : "text-destructive"}`}
                            >
                              {parseFloat(balance).toFixed(2)} USDT
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={!account ? connectWallet : handleJoinBlock}
                        disabled={isJoining || (account && !isRegisteredOnChain && parseFloat(balance) < block.levels.contribution_amount)}
                        className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-12"
                      >
                        {isJoining ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Procesando...
                          </>
                        ) : !account ? (
                          "Conectar Wallet"
                        ) : (
                          <>
                            <UserPlus className="w-4 h-4 mr-2" />
                            {isRegisteredOnChain ? "Unirme al Bloque (Gratis)" : "Unirme al Bloque"}
                          </>
                        )}
                      </Button>
                      {account && (
                        <Button
                          onClick={() => openAppKit()}
                          disabled={isJoining}
                          variant="outline"
                          className="rounded-xl h-12 px-4"
                          title="Cambiar wallet"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground">
                      {block.status === "completed" ? "Este bloque ya está completado" : "No hay lugares disponibles"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Block Completion Modal - Support both DB-backed and on-chain only blocks */}
      {block && block.contract_address && (userWallet || account) && (
        <BlockCompletionModal
          isOpen={showCompletionModal}
          onClose={() => setShowCompletionModal(false)}
          userId={user?.id || ""}
          walletAddress={userWallet?.wallet_address || account || ""}
          currentLevelId={block.level_id}
          currentLevelName={block.levels.name}
          totalEarnings={block.levels.total_cundina}
          nextLevelContribution={nextLevel?.contribution_amount || null}
          nextLevelName={nextLevel?.name || null}
          nextLevelId={nextLevel?.id || null}
          contractAddress={block.contract_address}
          onSuccess={() => {
            loadBlockDetails();
            navigate("/my-blocks");
          }}
        />
      )}
    </div>
  );
};

export default BlockDetail;
