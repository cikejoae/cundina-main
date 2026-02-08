
-- Trigger to automatically mark user_level_progress as completed when their block completes
CREATE OR REPLACE FUNCTION public.sync_block_completion_to_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When a block status changes to 'completed', mark the creator's level progress as completed
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    UPDATE public.user_level_progress
    SET status = 'completed',
        completed_at = NOW()
    WHERE user_id = NEW.creator_id
      AND wallet_id = NEW.wallet_id
      AND level_id = NEW.level_id
      AND block_id = NEW.id
      AND status = 'active';
    
    RAISE LOG 'Block % completed, updated user_level_progress for user % wallet % level %', 
      NEW.id, NEW.creator_id, NEW.wallet_id, NEW.level_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on blocks table
DROP TRIGGER IF EXISTS sync_block_completion ON public.blocks;
CREATE TRIGGER sync_block_completion
AFTER UPDATE ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION public.sync_block_completion_to_progress();
