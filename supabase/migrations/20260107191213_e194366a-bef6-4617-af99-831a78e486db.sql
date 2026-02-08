-- Add invited_members_count to blocks table
ALTER TABLE public.blocks 
ADD COLUMN IF NOT EXISTS invited_members_count integer DEFAULT 0;

-- Add assigned_members_count to track how many have been assigned to this block
ALTER TABLE public.blocks 
ADD COLUMN IF NOT EXISTS assigned_members_count integer DEFAULT 0;

-- Create function to update invited_members_count when someone registers via referral
CREATE OR REPLACE FUNCTION public.update_invited_members_count()
RETURNS TRIGGER AS $$
DECLARE
  referrer_wallet_id uuid;
  referrer_block_id uuid;
BEGIN
  -- Get the referrer wallet id from the new user's wallet
  referrer_wallet_id := NEW.referred_by_wallet_id;
  
  IF referrer_wallet_id IS NOT NULL THEN
    -- Find the active block created by the referrer wallet at level 1 or higher
    -- We increment the count on the referrer's CURRENT active block at their highest level
    SELECT b.id INTO referrer_block_id
    FROM blocks b
    WHERE b.wallet_id = referrer_wallet_id
      AND b.status = 'active'
    ORDER BY b.level_id DESC, b.created_at DESC
    LIMIT 1;
    
    IF referrer_block_id IS NOT NULL THEN
      UPDATE blocks
      SET invited_members_count = invited_members_count + 1
      WHERE id = referrer_block_id;
      
      RAISE NOTICE 'Updated invited_members_count for block %', referrer_block_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to update count when a new wallet is created with a referrer
DROP TRIGGER IF EXISTS trigger_update_invited_members ON user_wallets;
CREATE TRIGGER trigger_update_invited_members
  AFTER INSERT ON user_wallets
  FOR EACH ROW
  WHEN (NEW.referred_by_wallet_id IS NOT NULL)
  EXECUTE FUNCTION update_invited_members_count();

-- Create function to get the top block for assignment at a specific level
CREATE OR REPLACE FUNCTION public.get_top_block_for_assignment(target_level_id integer)
RETURNS TABLE(
  block_id uuid,
  available_slots integer
) AS $$
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
    b.current_members DESC,  -- More members = higher rank
    b.created_at ASC         -- Earlier = higher rank (faster)
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create function to assign a member to the top block and increment counter
CREATE OR REPLACE FUNCTION public.assign_member_to_top_block(
  p_user_id uuid,
  p_wallet_id uuid,
  p_level_id integer
)
RETURNS TABLE(
  assigned_block_id uuid,
  assigned_block_address text,
  creator_wallet_address text,
  was_assigned boolean
) AS $$
DECLARE
  v_top_block RECORD;
  v_next_position integer;
BEGIN
  -- Get the top block with available slots
  SELECT * INTO v_top_block
  FROM get_top_block_for_assignment(p_level_id);
  
  IF v_top_block IS NOT NULL AND v_top_block.available_slots > 0 THEN
    -- Get next position for the block
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_next_position
    FROM block_members
    WHERE block_id = v_top_block.block_id;
    
    -- Insert the member into the block
    INSERT INTO block_members (block_id, user_id, wallet_id, position)
    VALUES (v_top_block.block_id, p_user_id, p_wallet_id, v_next_position)
    ON CONFLICT DO NOTHING;
    
    -- Increment assigned_members_count
    UPDATE blocks
    SET assigned_members_count = assigned_members_count + 1
    WHERE id = v_top_block.block_id;
    
    -- Return the assigned block info
    RETURN QUERY
    SELECT 
      b.id,
      b.contract_address,
      b.creator_wallet_address,
      true as was_assigned
    FROM blocks b
    WHERE b.id = v_top_block.block_id;
  ELSE
    -- No block available, return null with was_assigned = false
    RETURN QUERY
    SELECT 
      NULL::uuid,
      NULL::text,
      NULL::text,
      false as was_assigned;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;