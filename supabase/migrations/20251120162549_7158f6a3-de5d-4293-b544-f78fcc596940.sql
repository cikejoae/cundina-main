
-- Enable realtime for blocks and block_members tables
ALTER TABLE public.blocks REPLICA IDENTITY FULL;
ALTER TABLE public.block_members REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.blocks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.block_members;
