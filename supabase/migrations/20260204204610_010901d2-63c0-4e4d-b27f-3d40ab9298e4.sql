-- Add is_active column to user_wallets for soft delete
ALTER TABLE public.user_wallets 
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Add deactivated_at timestamp to track when wallet was deactivated
ALTER TABLE public.user_wallets 
ADD COLUMN IF NOT EXISTS deactivated_at timestamp with time zone DEFAULT NULL;

-- Create index for efficient filtering of active wallets
CREATE INDEX IF NOT EXISTS idx_user_wallets_active ON public.user_wallets(user_id, is_active) WHERE is_active = true;

-- Update RLS policy for viewing wallets to include inactive ones (user can see their deactivated wallets)
-- No change needed - existing policy already allows users to view their own wallets

-- Add policy to allow reactivating a wallet by the original owner OR claiming an orphaned wallet
DROP POLICY IF EXISTS "Users can reactivate their own wallets" ON public.user_wallets;
CREATE POLICY "Users can reactivate their own wallets"
ON public.user_wallets
FOR UPDATE
USING (auth.uid() = user_id OR (is_active = false AND deactivated_at IS NOT NULL))
WITH CHECK (auth.uid() = user_id);

-- Comment explaining the soft delete pattern
COMMENT ON COLUMN public.user_wallets.is_active IS 'Soft delete flag. When false, wallet is deactivated but data preserved.';
COMMENT ON COLUMN public.user_wallets.deactivated_at IS 'Timestamp when wallet was deactivated. NULL means active.';