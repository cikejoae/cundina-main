import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { ethers } from "npm:ethers@6.15.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Block ABI for reading members
const BLOCK_ABI = [
  "function getMembers() external view returns (address[])",
  "function membersCount() external view returns (uint256)",
  "function status() external view returns (uint8)",
  "function owner() external view returns (address)",
  "function levelId() external view returns (uint256)",
];

// Registry ABI for referral code
const REGISTRY_ABI = [
  "function getReferralCode(address wallet) external view returns (bytes32)",
];

const REGISTRY_ADDRESS = "0xd13e3b5b61dEb4f4D1cfdc26988875FA9022AE5E";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rpcUrl = Deno.env.get("SEPOLIA_RPC_URL") || "https://eth-sepolia.g.alchemy.com/v2/demo";
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const body = await req.json().catch(() => ({}));
    const contractAddress = body?.contractAddress as string | undefined;
    
    if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
      return new Response(JSON.stringify({ error: "Missing or invalid contractAddress" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read block data directly from blockchain
    const blockContract = new ethers.Contract(contractAddress, BLOCK_ABI, provider);
    
    let members: string[] = [];
    let ownerAddress: string = "";
    let levelId: number = 1;
    let status: number = 0;
    
    try {
      [members, ownerAddress, levelId, status] = await Promise.all([
        blockContract.getMembers(),
        blockContract.owner(),
        blockContract.levelId().then((l: bigint) => Number(l)),
        blockContract.status().then((s: number) => Number(s)),
      ]);
    } catch (contractError) {
      console.error("Error reading block contract:", contractError);
      return new Response(JSON.stringify({ error: "Failed to read block contract" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get creator's referral code from Registry contract
    let creatorReferralCode: string | null = null;
    try {
      const registryContract = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
      const codeBytes = await registryContract.getReferralCode(ownerAddress);
      if (codeBytes && codeBytes !== ethers.ZeroHash) {
        // Return the full bytes32 without 0x prefix (uppercase)
        // This is the exact value needed for resolveReferralCode
        creatorReferralCode = codeBytes.slice(2).toUpperCase();
      }
    } catch (refError) {
      console.log("Could not get referral code from registry:", refError);
    }

    // Format members with positions (index + 1)
    const result = members.map((addr: string, index: number) => ({
      position: index + 1,
      wallet_address: addr.toLowerCase(),
    }));

    return new Response(JSON.stringify({ 
      members: result,
      creatorReferralCode,
      creatorWalletAddress: ownerAddress.toLowerCase(),
      levelId,
      status,
      contractAddress: contractAddress.toLowerCase()
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("block-members-public error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
