import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.80.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Users to KEEP (never delete)
const PROTECTED_EMAILS = [
  'adan@soredi.mx',
  'barretteduardo@gmail.com',
  'sctijuana@gmail.com',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🗑️ Starting auth users cleanup...');
    console.log('🛡️ Protected emails:', PROTECTED_EMAILS);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // List all users (paginated - get up to 1000)
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000,
    });

    if (listError) {
      console.error('❌ Error listing users:', listError);
      throw listError;
    }

    const allUsers = users || [];
    console.log(`📋 Found ${allUsers.length} total users in auth`);

    // Separate protected vs deletable
    const protectedUsers = allUsers.filter(u => 
      PROTECTED_EMAILS.includes(u.email?.toLowerCase() || '')
    );
    const usersToDelete = allUsers.filter(u => 
      !PROTECTED_EMAILS.includes(u.email?.toLowerCase() || '')
    );

    console.log(`🛡️ Keeping ${protectedUsers.length} protected users:`);
    protectedUsers.forEach(u => console.log(`  - ${u.email} (${u.id})`));
    console.log(`🗑️ Will delete ${usersToDelete.length} users`);

    let deletedCount = 0;
    const errors: any[] = [];

    for (const user of usersToDelete) {
      try {
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
        
        if (deleteError) {
          console.error(`❌ Error deleting ${user.email} (${user.id}):`, deleteError);
          errors.push({ userId: user.id, email: user.email, error: deleteError.message });
        } else {
          console.log(`✅ Deleted: ${user.email} (${user.id})`);
          deletedCount++;
        }
      } catch (err) {
        console.error(`❌ Exception deleting ${user.email} (${user.id}):`, err);
        errors.push({ userId: user.id, email: user.email, error: String(err) });
      }
    }

    console.log(`✅ Cleanup complete: ${deletedCount}/${usersToDelete.length} deleted, ${protectedUsers.length} kept`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Deleted ${deletedCount} users, kept ${protectedUsers.length} protected`,
        deletedCount,
        keptCount: protectedUsers.length,
        keptUsers: protectedUsers.map(u => u.email),
        totalUsers: allUsers.length,
        errors: errors.length > 0 ? errors : undefined
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: String(error)
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
