-- Function to validate level progression before block creation
CREATE OR REPLACE FUNCTION public.validate_block_level_progression()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_level_id INTEGER;
  previous_level_status TEXT;
BEGIN
  -- Level 1 is always allowed
  IF NEW.level_id = 1 THEN
    RETURN NEW;
  END IF;

  -- For levels > 1, check if previous level is completed
  previous_level_id := NEW.level_id - 1;

  SELECT status INTO previous_level_status
  FROM public.user_level_progress
  WHERE user_id = NEW.creator_id
    AND wallet_id = NEW.wallet_id
    AND level_id = previous_level_id;

  -- If no previous progress found or not completed, reject
  IF previous_level_status IS NULL THEN
    RAISE EXCEPTION 'Debes completar el Nivel % primero antes de crear un bloque en Nivel %', 
      previous_level_id, NEW.level_id;
  END IF;

  IF previous_level_status != 'completed' THEN
    RAISE EXCEPTION 'El Nivel % debe estar completado (estado actual: %) antes de crear un bloque en Nivel %', 
      previous_level_id, previous_level_status, NEW.level_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger to enforce level progression on block creation
DROP TRIGGER IF EXISTS enforce_block_level_progression ON public.blocks;
CREATE TRIGGER enforce_block_level_progression
  BEFORE INSERT ON public.blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_block_level_progression();