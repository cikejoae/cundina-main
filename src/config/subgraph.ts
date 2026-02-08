// Subgraph configuration for on-chain data indexing
// Replace with your actual subgraph URL once deployed to The Graph

export const SUBGRAPH_CONFIG = {
  // Production Gateway via edge function proxy (uses API key server-side)
  // The proxy forwards queries to: https://gateway.thegraph.com/api/subgraphs/id/{subgraph_id}
  PROXY_FUNCTION: "subgraph-proxy",

  // Fallback: Development/Studio URL (rate-limited, 3000 queries/day)
  STUDIO_URL: "https://api.studio.thegraph.com/query/1740282/cundinablock-v-1/version/latest",

  // Whether to use the production proxy (true) or studio fallback (false)
  USE_PROXY: true,

  // Network configuration
  NETWORK: "sepolia",

  // Query limits
  DEFAULT_PAGE_SIZE: 100,
  MAX_PAGE_SIZE: 1000,
} as const;

export type BlockStatus = 0 | 1; // 0 = Active, 1 = Completed

// Subgraph entity types (matching schema.graphql)
export interface SubgraphUser {
  id: string; // wallet address (lowercase)
  level: number;
  referrer?: SubgraphUser | null;
  referralCode: string;
  registeredAt: string;
  blocks?: SubgraphBlock[];
  memberships?: SubgraphBlockMember[];
  invitedUsers?: SubgraphUser[];
}

export interface SubgraphBlock {
  id: string; // contract address (lowercase)
  owner: SubgraphUser;
  levelId: number;
  status: BlockStatus;
  members?: SubgraphBlockMember[];
  invitedCount: number;
  createdAt: string;
  completedAt?: string | null;
}

export interface SubgraphBlockMember {
  id: string; // block_address + member_address
  block: SubgraphBlock;
  member: SubgraphUser;
  position: number;
  joinedAt: string;
}

export interface SubgraphTransaction {
  id: string; // tx hash
  user: SubgraphUser;
  type: "registration" | "join" | "advance" | "withdraw";
  amount: string;
  block?: SubgraphBlock | null;
  timestamp: string;
}
