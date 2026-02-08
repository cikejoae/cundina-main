// Contract addresses deployed on Sepolia testnet
// Architecture: Registry + Implementation Clones + Treasury Safe + Payout Module
// Last updated: Feb 2026 (V5 - platformWallet removed, SocCoop branding)
export const CONTRACTS = {
  // Test USDT Token (6 decimals, like real USDT)
  USDT_TOKEN: "0xf23cAd5D0B38ad7708E63c065C67d446aeD8c064" as const,

  // Registry Architecture V5 (deployed via Remix - Feb 2026)
  IMPLEMENTATION: "0x9c62284fe7C758Be4996DF064Bba3b1E4Ddc83B8" as const,
  REGISTRY: "0xd13e3b5b61dEb4f4D1cfdc26988875FA9022AE5E" as const,
  PAYOUT_MODULE: "0x4B4A6047A7B6246FACe6A1605741e190441eaED3" as const,

  // Treasury Gnosis Safe (receives all contributions, module enabled for payouts)
  TREASURY: "0x83056150CD2FDB7E1fc5286bd25Ffe0EE2EB612a" as const,
} as const;

// For backwards compatibility with existing code
export const USDT_TOKEN_ADDRESS = CONTRACTS.USDT_TOKEN;
export const BLOCK_FACTORY_ADDRESS = CONTRACTS.REGISTRY;
export const TREASURY_ADDRESS = CONTRACTS.TREASURY;

// USDT uses 6 decimals (like real USDT on mainnet)
export const USDT_DECIMALS = 6;
