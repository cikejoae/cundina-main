import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUBGRAPH_ID = "5dJWaGD3e9MwbgcfXx5yciD3FaZcFBjNfDeE8QPJeLj8";
const GATEWAY_URL = `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`;

async function querySubgraph(query: string, variables?: Record<string, unknown>) {
  const apiKey = Deno.env.get("THE_GRAPH_API_KEY");
  if (!apiKey) throw new Error("THE_GRAPH_API_KEY not configured");

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || "Subgraph error");
  return json.data;
}

// Get recent block member joins (last N seconds)
const RECENT_JOINS_QUERY = `
  query GetRecentJoins($since: BigInt!) {
    blockMembers(
      where: { joinedAt_gte: $since }
      orderBy: joinedAt
      orderDirection: desc
      first: 100
    ) {
      id
      member { id }
      block { id owner { id } levelId }
      position
      joinedAt
    }
  }
`;

// Get recent transactions
const RECENT_TX_QUERY = `
  query GetRecentTx($since: BigInt!) {
    transactions(
      where: { timestamp_gte: $since }
      orderBy: timestamp
      orderDirection: desc
      first: 100
    ) {
      id
      user { id }
      type
      amount
      block { id levelId }
      timestamp
    }
  }
`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Look back 5 minutes for new events
    const sinceTimestamp = Math.floor(Date.now() / 1000) - 300;

    const [joinsData, txData] = await Promise.all([
      querySubgraph(RECENT_JOINS_QUERY, { since: sinceTimestamp.toString() }),
      querySubgraph(RECENT_TX_QUERY, { since: sinceTimestamp.toString() }),
    ]);

    const joins = joinsData?.blockMembers || [];
    const txs = txData?.transactions || [];

    let notificationsCreated = 0;

    // Get all wallet-to-user mappings we'll need
    const allWallets = new Set<string>();
    for (const join of joins) {
      allWallets.add(join.block.owner.id.toLowerCase());
      allWallets.add(join.member.id.toLowerCase());
    }
    for (const tx of txs) {
      allWallets.add(tx.user.id.toLowerCase());
    }

    // Query user_wallets to map wallet addresses to user IDs
    const { data: walletMappings } = await supabase
      .from("user_wallets")
      .select("user_id, wallet_address")
      .in("wallet_address", Array.from(allWallets))
      .eq("is_active", true);

    const walletToUserId = new Map<string, string>();
    for (const w of walletMappings || []) {
      walletToUserId.set(w.wallet_address.toLowerCase(), w.user_id);
    }

    // Process joins: notify block owner when someone joins their block
    for (const join of joins) {
      const ownerWallet = join.block.owner.id.toLowerCase();
      const memberWallet = join.member.id.toLowerCase();
      const ownerUserId = walletToUserId.get(ownerWallet);

      // Don't notify if owner joined their own block
      if (ownerWallet === memberWallet) continue;
      if (!ownerUserId) continue;

      const truncatedMember = `${memberWallet.slice(0, 6)}...${memberWallet.slice(-4)}`;

      // Check if notification already exists (prevent duplicates)
      const notifId = `join_${join.id}`;
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", ownerUserId)
        .eq("title", `Nuevo miembro en tu bloque`)
        .eq("message", `${truncatedMember} se unió a tu bloque Nivel ${join.block.levelId} (posición ${join.position})`)
        .limit(1);

      if (existing && existing.length > 0) continue;

      await supabase.from("notifications").insert({
        user_id: ownerUserId,
        title: "Nuevo miembro en tu bloque",
        message: `${truncatedMember} se unió a tu bloque Nivel ${join.block.levelId} (posición ${join.position})`,
        type: "success",
      });
      notificationsCreated++;
    }

    // Process advance transactions: notify user about level ups
    for (const tx of txs) {
      if (tx.type !== "advance") continue;

      const userWallet = tx.user.id.toLowerCase();
      const userId = walletToUserId.get(userWallet);
      if (!userId) continue;

      const levelId = tx.block?.levelId || 0;

      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("title", "¡Subiste de nivel!")
        .ilike("message", `%${tx.id}%`)
        .limit(1);

      if (existing && existing.length > 0) continue;

      await supabase.from("notifications").insert({
        user_id: userId,
        title: "¡Subiste de nivel!",
        message: `Tu bloque Nivel ${levelId} se completó. ¡Felicidades! (tx: ${tx.id.slice(0, 10)}...)`,
        type: "success",
      });
      notificationsCreated++;
    }

    // Process join transactions: notify the user themselves
    for (const tx of txs) {
      if (tx.type !== "join") continue;

      const userWallet = tx.user.id.toLowerCase();
      const userId = walletToUserId.get(userWallet);
      if (!userId) continue;

      const levelId = tx.block?.levelId || 0;

      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("title", "Te uniste a un bloque")
        .ilike("message", `%${tx.id}%`)
        .limit(1);

      if (existing && existing.length > 0) continue;

      await supabase.from("notifications").insert({
        user_id: userId,
        title: "Te uniste a un bloque",
        message: `Te uniste exitosamente a un bloque Nivel ${levelId}. (tx: ${tx.id.slice(0, 10)}...)`,
        type: "info",
      });
      notificationsCreated++;
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        notificationsCreated,
        joinsProcessed: joins.length,
        txsProcessed: txs.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in sync-notifications:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
