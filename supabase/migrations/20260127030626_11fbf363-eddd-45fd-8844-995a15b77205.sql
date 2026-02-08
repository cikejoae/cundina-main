-- Remove is_primary column and related triggers/functions
-- This makes each wallet independent, no more "primary" wallet concept

-- Drop the function with CASCADE (will also drop dependent trigger)
DROP FUNCTION IF EXISTS ensure_single_primary_wallet() CASCADE;

-- Update RLS policy for deletion (remove is_primary restriction)
DROP POLICY IF EXISTS "Users can delete their own wallets" ON user_wallets;

CREATE POLICY "Users can delete their own wallets"
ON user_wallets
FOR DELETE
USING (auth.uid() = user_id);

-- Remove the is_primary column
ALTER TABLE user_wallets DROP COLUMN IF EXISTS is_primary;