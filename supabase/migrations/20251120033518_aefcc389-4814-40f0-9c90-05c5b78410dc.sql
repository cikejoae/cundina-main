-- Fix the unique constraint on user_level_progress
-- The constraint should be on (wallet_id, level_id) not (user_id, level_id)
-- since each wallet has independent progress

-- Drop the old constraint
ALTER TABLE public.user_level_progress 
DROP CONSTRAINT IF EXISTS user_level_progress_user_id_level_id_key;

-- Add the new constraint on (wallet_id, level_id)
ALTER TABLE public.user_level_progress 
ADD CONSTRAINT user_level_progress_wallet_id_level_id_key 
UNIQUE (wallet_id, level_id);