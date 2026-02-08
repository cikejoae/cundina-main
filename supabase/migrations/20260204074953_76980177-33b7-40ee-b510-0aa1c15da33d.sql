
-- Fix get_top_block_for_assignment to prioritize blocks with more invited participants
CREATE OR REPLACE FUNCTION public.get_top_block_for_assignment(target_level_id integer)
RETURNS TABLE(block_id uuid, available_slots integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    b.id as block_id,
    (b.invited_members_count - b.assigned_members_count) as available_slots
  FROM blocks b
  WHERE b.level_id = target_level_id
    AND b.status = 'active'
    AND b.invited_members_count > b.assigned_members_count
  ORDER BY 
    b.invited_members_count DESC,  -- More invited participants = higher priority
    b.current_members DESC,         -- Tiebreaker: more members
    b.created_at ASC                -- Tiebreaker: earlier created
  LIMIT 1;
END;
$function$;
