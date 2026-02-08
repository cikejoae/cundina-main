-- Add unique constraint to prevent multiple blocks per wallet per level
ALTER TABLE public.blocks 
ADD CONSTRAINT unique_wallet_level_block 
UNIQUE (wallet_id, level_id);