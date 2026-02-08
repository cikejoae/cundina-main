import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6.15.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { walletAddress, signature, message, action } = await req.json();

    if (!walletAddress || !signature || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: walletAddress, signature, message' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedAddress = walletAddress.toLowerCase();

    // Verify the signature matches the wallet address
    let recoveredAddress: string;
    try {
      recoveredAddress = ethers.verifyMessage(message, signature).toLowerCase();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (recoveredAddress !== normalizedAddress) {
      return new Response(
        JSON.stringify({ error: 'Signature does not match wallet address' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify message contains valid timestamp (within 5 minutes)
    const timestampMatch = message.match(/Timestamp: (\d+)/);
    if (timestampMatch) {
      const msgTimestamp = parseInt(timestampMatch[1]);
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      if (Math.abs(now - msgTimestamp) > fiveMinutes) {
        return new Response(
          JSON.stringify({ error: 'Message expired, please sign again' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Create Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if wallet exists in user_wallets
    const { data: existingWallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('user_id, user:user_id(id, email)')
      .eq('wallet_address', normalizedAddress)
      .maybeSingle();

    if (walletError && walletError.code !== 'PGRST116') {
      throw walletError;
    }

    if (existingWallet?.user_id) {
      // User exists - generate a session token
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', existingWallet.user_id)
        .single();

      if (!profile?.email) {
        return new Response(
          JSON.stringify({ error: 'User profile incomplete', isNewUser: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generate magic link token for the user
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: profile.email,
        options: {
          redirectTo: `${req.headers.get('origin')}/dashboard`,
        }
      });

      if (linkError) {
        console.error('Generate link error:', linkError);
        throw linkError;
      }

      // Extract token from the link and create session directly
      const { data: sessionData, error: sessionError } = await supabase.auth.admin.getUserById(
        existingWallet.user_id
      );

      if (sessionError) {
        throw sessionError;
      }

      // Create a custom token for the user session
      // Using the magic link approach - return the hashed token
      const tokenHash = linkData.properties?.hashed_token;
      const verificationToken = linkData.properties?.verification_type === 'magiclink' 
        ? new URL(linkData.properties.action_link).searchParams.get('token')
        : null;

      return new Response(
        JSON.stringify({ 
          success: true, 
          isNewUser: false,
          userId: existingWallet.user_id,
          email: profile.email,
          // Return the magic link token for client-side verification
          token: verificationToken,
          tokenHash,
          type: 'magiclink'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Wallet doesn't exist - this is a new user
    return new Response(
      JSON.stringify({ 
        success: true, 
        isNewUser: true,
        walletAddress: normalizedAddress 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Wallet auth error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
