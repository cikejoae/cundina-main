
-- Drop the existing unique constraint on (block_id, user_id)
ALTER TABLE public.block_members 
DROP CONSTRAINT IF EXISTS block_members_block_id_user_id_key;

-- Add new unique constraint on (block_id, wallet_id) to prevent same wallet joining twice
ALTER TABLE public.block_members 
ADD CONSTRAINT block_members_block_id_wallet_id_key UNIQUE (block_id, wallet_id);
