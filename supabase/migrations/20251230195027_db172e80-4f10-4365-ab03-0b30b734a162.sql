-- Create function to update block member count
CREATE OR REPLACE FUNCTION public.update_block_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.blocks
    SET current_members = (
      SELECT COUNT(*) FROM public.block_members WHERE block_id = NEW.block_id
    )
    WHERE id = NEW.block_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.blocks
    SET current_members = (
      SELECT COUNT(*) FROM public.block_members WHERE block_id = OLD.block_id
    )
    WHERE id = OLD.block_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for insert
CREATE TRIGGER trigger_update_block_member_count_insert
AFTER INSERT ON public.block_members
FOR EACH ROW
EXECUTE FUNCTION public.update_block_member_count();

-- Create trigger for delete
CREATE TRIGGER trigger_update_block_member_count_delete
AFTER DELETE ON public.block_members
FOR EACH ROW
EXECUTE FUNCTION public.update_block_member_count();