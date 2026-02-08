-- Fix member counting (exclude creator / position 0) and ensure automatic sync
CREATE OR REPLACE FUNCTION public.update_block_member_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_block_id uuid;
BEGIN
  target_block_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.block_id ELSE OLD.block_id END;

  UPDATE public.blocks
  SET current_members = (
    SELECT COUNT(*)
    FROM public.block_members
    WHERE block_id = target_block_id
      AND position > 0
  )
  WHERE id = target_block_id;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS update_block_member_count ON public.block_members;
CREATE TRIGGER update_block_member_count
AFTER INSERT OR DELETE ON public.block_members
FOR EACH ROW
EXECUTE FUNCTION public.update_block_member_count();

-- Default should be 0 (no members) so new blocks don't appear as 1/9
ALTER TABLE public.blocks
ALTER COLUMN current_members SET DEFAULT 0;
