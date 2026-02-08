 // Hook for reading data directly from blockchain contracts
 import { useCallback, useMemo } from "react";
 import { usePublicClient, useAccount } from "wagmi";
 import { type Address } from "viem";
 import {
   readUserLevel,
   readMyBlockAtLevel,
   readAllUserBlocks,
   readBlockData,
   readReferralCode,
   resolveReferralCode,
   readReferrer,
   readTokenBalance,
   ZERO_ADDRESS,
 } from "@/lib/contractReads";
 import { USDT_TOKEN_ADDRESS } from "@/config/contracts";
 import { querySubgraph } from "@/lib/subgraph";
 
 // Re-export the type for consumers
 export type { OnChainBlockData } from "@/lib/contractReads";
 
 import type { OnChainBlockData } from "@/lib/contractReads";
 
 export interface UseOnChainDataReturn {
   // User data
   getUserLevel: (address?: Address) => Promise<number>;
   getUserBlocks: (address?: Address) => Promise<OnChainBlockData[]>;
   getUserMemberships: (address?: Address) => Promise<OnChainBlockData[]>;
   getMyBlockAtLevel: (level: number, address?: Address) => Promise<Address | null>;
   
   // Block data
   getBlockInfo: (blockAddress: Address) => Promise<OnChainBlockData | null>;
   
   // Referral system (requires contract upgrade)
   getReferralCode: (address?: Address) => Promise<string | null>;
   resolveReferralCode: (code: string) => Promise<Address | null>;
   getReferrer: (address?: Address) => Promise<Address | null>;
   
   // Token balance
   getTokenBalance: (address?: Address) => Promise<{ balance: bigint; formatted: string }>;
   
   // Connection state
   isReady: boolean;
   account: Address | undefined;
 }
 
 /**
  * Hook for reading on-chain data directly from contracts.
  * 
  * This hook provides functions to read user levels, blocks, referral codes,
  * and other data directly from the blockchain without relying on a database.
  * 
  * For functions requiring contract upgrade (referral codes), they will return
  * null gracefully if the contract doesn't support them yet.
  */
 export const useOnChainData = (): UseOnChainDataReturn => {
   const publicClient = usePublicClient();
   const { address: account, isConnected } = useAccount();
 
   const isReady = useMemo(
     () => !!publicClient && isConnected,
     [publicClient, isConnected]
   );
 
   // ============= User Data =============
 
   const getUserLevel = useCallback(
     async (address?: Address): Promise<number> => {
       const target = address || account;
       if (!publicClient || !target) return 0;
       return readUserLevel(publicClient, target);
     },
     [publicClient, account]
   );
 
   const getMyBlockAtLevel = useCallback(
     async (level: number, address?: Address): Promise<Address | null> => {
       const target = address || account;
       if (!publicClient || !target) return null;
       return readMyBlockAtLevel(publicClient, target, level);
     },
     [publicClient, account]
   );
 
   const getUserBlocks = useCallback(
     async (address?: Address): Promise<OnChainBlockData[]> => {
       const target = address || account;
       if (!publicClient || !target) return [];
 
       const blockAddresses = await readAllUserBlocks(publicClient, target);
       const blocks: OnChainBlockData[] = [];
 
       // Fetch block data in parallel
       const blockDataPromises = blockAddresses.map((addr) =>
         readBlockData(publicClient, addr)
       );
       const blockDataResults = await Promise.all(blockDataPromises);
 
       for (const data of blockDataResults) {
         if (data) {
           blocks.push(data);
         }
       }
 
       // Sort by levelId ascending
       return blocks.sort((a, b) => a.levelId - b.levelId);
     },
     [publicClient, account]
    );
  
    // ============= User Memberships (blocks where user is a member, not owner) =============
    
    const getUserMemberships = useCallback(
      async (address?: Address): Promise<OnChainBlockData[]> => {
        const target = address || account;
        if (!publicClient || !target) return [];
        
        try {
          // Query Subgraph for memberships (uses querySubgraph which respects cooldown)
          const query = `
            query GetUserMemberships($userAddress: String!) {
              blockMembers(where: { member: $userAddress }) {
                block {
                  id
                }
              }
            }
          `;
          
          const result = await querySubgraph<{ blockMembers: { block: { id: string } }[] }>(
            query,
            { userAddress: target.toLowerCase() }
          );
          
          // Get unique block addresses
          const blockAddresses = [...new Set(
            result.blockMembers.map((m) => m.block.id as Address)
          )];
          
          // Fetch block data for each
          const blocks: OnChainBlockData[] = [];
          for (const addr of blockAddresses) {
            const data = await readBlockData(publicClient, addr as Address);
            if (data && data.owner.toLowerCase() !== target.toLowerCase()) {
              // Only include blocks where user is NOT the owner
              blocks.push(data);
            }
          }
          
          return blocks.sort((a, b) => a.levelId - b.levelId);
        } catch (err) {
          console.warn("[useOnChainData] getUserMemberships failed:", err);
          return [];
        }
      },
      [publicClient, account]
    );
  
    // ============= Block Data =============

    const getBlockInfo = useCallback(
      async (blockAddress: Address): Promise<OnChainBlockData | null> => {
        if (!publicClient) return null;
        return readBlockData(publicClient, blockAddress);
      },
      [publicClient]
    );
 
   // ============= Referral System =============
 
   const getReferralCode = useCallback(
     async (address?: Address): Promise<string | null> => {
       const target = address || account;
       if (!publicClient || !target) return null;
       return readReferralCode(publicClient, target);
     },
     [publicClient, account]
   );
 
   const resolveReferralCodeFn = useCallback(
     async (code: string): Promise<Address | null> => {
       if (!publicClient || !code) return null;
       return resolveReferralCode(publicClient, code);
     },
     [publicClient]
   );
 
   const getReferrer = useCallback(
     async (address?: Address): Promise<Address | null> => {
       const target = address || account;
       if (!publicClient || !target) return null;
       return readReferrer(publicClient, target);
     },
     [publicClient, account]
   );
 
   // ============= Token Balance =============
 
   const getTokenBalance = useCallback(
     async (address?: Address): Promise<{ balance: bigint; formatted: string }> => {
       const target = address || account;
       if (!publicClient || !target) {
         return { balance: 0n, formatted: "0" };
       }
       const result = await readTokenBalance(publicClient, target, USDT_TOKEN_ADDRESS);
       return { balance: result.balance, formatted: result.formatted };
     },
     [publicClient, account]
   );
 
    return {
      // User data
      getUserLevel,
      getUserBlocks,
      getUserMemberships,
      getMyBlockAtLevel,
      
      // Block data
      getBlockInfo,
      
      // Referral system
      getReferralCode,
      resolveReferralCode: resolveReferralCodeFn,
      getReferrer,
      
      // Token balance
      getTokenBalance,
      
      // Connection state
      isReady,
      account,
    };
  };