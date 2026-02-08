 // Hook for querying The Graph subgraph
 import { useCallback, useState } from "react";
 import {
   querySubgraph,
   RANKING_QUERY,
   USER_BLOCKS_QUERY,
   USER_BY_REFERRAL_CODE_QUERY,
   BLOCK_DETAILS_QUERY,
   USER_TRANSACTIONS_QUERY,
   type RankingQueryResult,
   type UserBlocksQueryResult,
   type UserByReferralCodeQueryResult,
   type BlockDetailsQueryResult,
   type UserTransactionsQueryResult,
 } from "@/lib/subgraph";
 import { SUBGRAPH_CONFIG, type SubgraphBlock, type SubgraphUser } from "@/config/subgraph";
 
 export interface UseSubgraphQueryReturn {
   // Queries
   fetchRanking: (levelId: number, status?: number, page?: number) => Promise<SubgraphBlock[]>;
   fetchUserBlocks: (userAddress: string) => Promise<SubgraphUser | null>;
   fetchUserByReferralCode: (code: string) => Promise<SubgraphUser | null>;
   fetchBlockDetails: (blockAddress: string) => Promise<SubgraphBlock | null>;
   fetchUserTransactions: (userAddress: string, page?: number) => Promise<UserTransactionsQueryResult["transactions"]>;
   
   // State
   isLoading: boolean;
   error: Error | null;
   
   // Availability check
   isSubgraphAvailable: () => Promise<boolean>;
 }
 
 /**
  * Hook for querying The Graph subgraph.
  * 
  * This hook provides functions to fetch ranking, user blocks, transactions,
  * and other indexed data from the subgraph. It gracefully handles errors
  * and provides loading state.
  * 
  * Note: The subgraph must be deployed and synced for these queries to work.
  * Check isSubgraphAvailable() before relying on subgraph data.
  */
 export const useSubgraphQuery = (): UseSubgraphQueryReturn => {
   const [isLoading, setIsLoading] = useState(false);
   const [error, setError] = useState<Error | null>(null);
 
   // ============= Availability Check =============
 
   const isSubgraphAvailable = useCallback(async (): Promise<boolean> => {
     try {
       // Simple health check query
       await querySubgraph<{ _meta: { block: { number: number } } }>(
         `{ _meta { block { number } } }`
       );
       return true;
     } catch {
       return false;
     }
   }, []);
 
   // ============= Ranking Query =============
 
   const fetchRanking = useCallback(
     async (
       levelId: number,
       status: number = 0, // 0 = Active by default
       page: number = 0
     ): Promise<SubgraphBlock[]> => {
       setIsLoading(true);
       setError(null);
 
       try {
         const result = await querySubgraph<RankingQueryResult>(RANKING_QUERY, {
           levelId,
           status,
           first: SUBGRAPH_CONFIG.DEFAULT_PAGE_SIZE,
           skip: page * SUBGRAPH_CONFIG.DEFAULT_PAGE_SIZE,
         });
         return result.blocks || [];
       } catch (err) {
         const error = err instanceof Error ? err : new Error("Failed to fetch ranking");
         setError(error);
         console.error("[useSubgraphQuery] fetchRanking failed:", error);
         return [];
       } finally {
         setIsLoading(false);
       }
     },
     []
   );
 
   // ============= User Blocks Query =============
 
   const fetchUserBlocks = useCallback(
     async (userAddress: string): Promise<SubgraphUser | null> => {
       if (!userAddress) return null;
 
       setIsLoading(true);
       setError(null);
 
       try {
         const result = await querySubgraph<UserBlocksQueryResult>(USER_BLOCKS_QUERY, {
           userId: userAddress.toLowerCase(),
         });
         return result.user || null;
       } catch (err) {
         const error = err instanceof Error ? err : new Error("Failed to fetch user blocks");
         setError(error);
         console.error("[useSubgraphQuery] fetchUserBlocks failed:", error);
         return null;
       } finally {
         setIsLoading(false);
       }
     },
     []
   );
 
   // ============= Referral Code Query =============
 
   const fetchUserByReferralCode = useCallback(
     async (code: string): Promise<SubgraphUser | null> => {
       if (!code) return null;
 
       setIsLoading(true);
       setError(null);
 
       try {
         const result = await querySubgraph<UserByReferralCodeQueryResult>(
           USER_BY_REFERRAL_CODE_QUERY,
           { code }
         );
         return result.users?.[0] || null;
       } catch (err) {
         const error = err instanceof Error ? err : new Error("Failed to fetch user by referral code");
         setError(error);
         console.error("[useSubgraphQuery] fetchUserByReferralCode failed:", error);
         return null;
       } finally {
         setIsLoading(false);
       }
     },
     []
   );
 
   // ============= Block Details Query =============
 
   const fetchBlockDetails = useCallback(
     async (blockAddress: string): Promise<SubgraphBlock | null> => {
       if (!blockAddress) return null;
 
       setIsLoading(true);
       setError(null);
 
       try {
         const result = await querySubgraph<BlockDetailsQueryResult>(BLOCK_DETAILS_QUERY, {
           blockId: blockAddress.toLowerCase(),
         });
         return result.block || null;
       } catch (err) {
         const error = err instanceof Error ? err : new Error("Failed to fetch block details");
         setError(error);
         console.error("[useSubgraphQuery] fetchBlockDetails failed:", error);
         return null;
       } finally {
         setIsLoading(false);
       }
     },
     []
   );
 
   // ============= User Transactions Query =============
 
   const fetchUserTransactions = useCallback(
     async (
       userAddress: string,
       page: number = 0
     ): Promise<UserTransactionsQueryResult["transactions"]> => {
       if (!userAddress) return [];
 
       setIsLoading(true);
       setError(null);
 
       try {
         const result = await querySubgraph<UserTransactionsQueryResult>(
           USER_TRANSACTIONS_QUERY,
           {
             userId: userAddress.toLowerCase(),
             first: SUBGRAPH_CONFIG.DEFAULT_PAGE_SIZE,
             skip: page * SUBGRAPH_CONFIG.DEFAULT_PAGE_SIZE,
           }
         );
         return result.transactions || [];
       } catch (err) {
         const error = err instanceof Error ? err : new Error("Failed to fetch user transactions");
         setError(error);
         console.error("[useSubgraphQuery] fetchUserTransactions failed:", error);
         return [];
       } finally {
         setIsLoading(false);
       }
     },
     []
   );
 
   return {
     // Queries
     fetchRanking,
     fetchUserBlocks,
     fetchUserByReferralCode,
     fetchBlockDetails,
     fetchUserTransactions,
     
     // State
     isLoading,
     error,
     
     // Availability check
     isSubgraphAvailable,
   };
 };