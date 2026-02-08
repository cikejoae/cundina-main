-- Create function to increment invited_members_count on a block
CREATE OR REPLACE FUNCTION public.increment_invited_members(block_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.blocks
  SET invited_members_count = COALESCE(invited_members_count, 0) + 1
  WHERE id = block_uuid;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.increment_invited_members(UUID) TO authenticated;