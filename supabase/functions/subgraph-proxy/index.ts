import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Production Gateway URL with the published Subgraph ID
const SUBGRAPH_ID = "5dJWaGD3e9MwbgcfXx5yciD3FaZcFBjNfDeE8QPJeLj8";
const GATEWAY_URL = `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const apiKey = Deno.env.get('THE_GRAPH_API_KEY');
  if (!apiKey) {
    console.error('[subgraph-proxy] THE_GRAPH_API_KEY not configured');
    return new Response(
      JSON.stringify({ error: 'Subgraph API key not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.text();
    console.log('[subgraph-proxy] Forwarding query to The Graph Gateway');

    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[subgraph-proxy] Gateway error: ${response.status} - ${responseText}`);
    } else {
      console.log('[subgraph-proxy] Query successful');
    }

    return new Response(responseText, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('[subgraph-proxy] Error:', error.message);
    return new Response(
      JSON.stringify({ error: 'Failed to proxy subgraph request', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
