// GraphQL client for The Graph subgraph queries
import { SUBGRAPH_CONFIG, SubgraphBlock, SubgraphUser, SubgraphBlockMember } from "@/config/subgraph";
import { recordRateLimit, recordSuccess, isSubgraphInCooldown, getCooldownRemaining } from "@/lib/subgraphThrottle";
import { supabase } from "@/integrations/supabase/client";

export interface SubgraphError {
  message: string;
  locations?: { line: number; column: number }[];
}

export interface SubgraphResponse<T> {
  data?: T;
  errors?: SubgraphError[];
}

/**
 * Execute a GraphQL query via the production proxy (edge function)
 * or fallback to Studio URL if proxy is disabled.
 */
async function executeQuery(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  if (SUBGRAPH_CONFIG.USE_PROXY) {
    // Use edge function proxy (API key is server-side)
    const { data, error } = await supabase.functions.invoke('subgraph-proxy', {
      body: { query, variables },
    });

    if (error) {
      // Check if it's a rate limit from the gateway
      if (error.message?.includes('429') || error.message?.includes('rate limit')) {
        return { status: 429, data: null };
      }
      throw new Error(`Proxy error: ${error.message}`);
    }

    return { status: 200, data };
  }

  // Fallback: direct Studio URL (rate-limited)
  const response = await fetch(SUBGRAPH_CONFIG.STUDIO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json();
  return { status: response.status, data: result };
}

/**
 * Execute a GraphQL query against the subgraph.
 * Uses the production proxy by default, with Studio fallback.
 * Respects rate-limit cooldown to prevent 429 storms.
 */
export async function querySubgraph<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  // Check cooldown before making request
  if (isSubgraphInCooldown()) {
    const remaining = getCooldownRemaining();
    throw new Error(`Subgraph in cooldown (${remaining}s remaining)`);
  }

  const { status, data: result } = await executeQuery(query, variables);

  if (status === 429) {
    recordRateLimit();
    throw new Error(`Subgraph request failed: 429 (rate limited)`);
  }

  // Handle the response data
  const typedResult = result as SubgraphResponse<T>;

  if (typedResult?.errors && typedResult.errors.length > 0) {
    throw new Error(`Subgraph query error: ${typedResult.errors[0].message}`);
  }

  if (!typedResult?.data) {
    throw new Error("Subgraph returned no data");
  }

  // Success — reset cooldown
  recordSuccess();

  return typedResult.data;
}
 
 // ============= Pre-built Queries =============
 
 /**
  * Get ranking for a specific level
  */
 export const RANKING_QUERY = `
   query GetRanking($levelId: Int!, $status: Int!, $first: Int!, $skip: Int!) {
     blocks(
       where: { levelId: $levelId, status: $status }
       orderBy: invitedCount
       orderDirection: desc
       first: $first
       skip: $skip
     ) {
       id
       owner {
         id
         level
         referralCode
       }
       levelId
       status
       invitedCount
       members {
         id
         member {
           id
         }
         position
       }
       createdAt
       completedAt
     }
   }
 `;
 
 /**
  * Get all blocks for a user
  */
 export const USER_BLOCKS_QUERY = `
   query GetUserBlocks($userId: String!) {
     user(id: $userId) {
       id
       level
       referralCode
       blocks {
         id
         levelId
         status
         invitedCount
         createdAt
         completedAt
         members {
           id
           position
           member {
             id
           }
         }
       }
       memberships {
         id
         position
         joinedAt
         block {
           id
           levelId
           status
           owner {
             id
           }
         }
       }
     }
   }
 `;
 
 /**
  * Get user by referral code
  */
 export const USER_BY_REFERRAL_CODE_QUERY = `
   query GetUserByReferralCode($code: String!) {
     users(where: { referralCode: $code }, first: 1) {
       id
       level
       referralCode
       referrer {
         id
       }
     }
   }
 `;
 
 /**
  * Get block details
  */
export const BLOCK_DETAILS_QUERY = `
  query GetBlockDetails($blockId: String!) {
    block(id: $blockId) {
      id
      owner {
        id
        level
        referralCode
      }
      levelId
      status
      invitedCount
      createdAt
      completedAt
      members(orderBy: position, orderDirection: asc) {
        id
        position
        joinedAt
        member {
          id
        }
      }
    }
  }
`;
 
 /**
  * Get transaction history for a user
  */
 export const USER_TRANSACTIONS_QUERY = `
   query GetUserTransactions($userId: String!, $first: Int!, $skip: Int!) {
     transactions(
       where: { user: $userId }
       orderBy: timestamp
       orderDirection: desc
       first: $first
       skip: $skip
     ) {
       id
       type
       amount
       timestamp
       block {
         id
         levelId
       }
     }
   }
 `;
 
 // ============= Helper Types for Query Results =============
 
 export interface RankingQueryResult {
   blocks: SubgraphBlock[];
 }
 
 export interface UserBlocksQueryResult {
   user: SubgraphUser | null;
 }
 
 export interface UserByReferralCodeQueryResult {
   users: SubgraphUser[];
 }
 
 export interface BlockDetailsQueryResult {
   block: SubgraphBlock | null;
 }
 
 export interface UserTransactionsQueryResult {
   transactions: {
     id: string;
     type: string;
     amount: string;
     timestamp: string;
     block?: {
       id: string;
       levelId: number;
     } | null;
   }[];
 }