-- Create table to store ranking positions for trend indicators
CREATE TABLE public.ranking_positions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  level_id integer NOT NULL REFERENCES public.levels(id),
  block_id uuid NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  position integer NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(level_id, block_id)
);

-- Enable RLS
ALTER TABLE public.ranking_positions ENABLE ROW LEVEL SECURITY;

-- Anyone can read ranking positions (public data)
CREATE POLICY "Anyone can view ranking positions"
ON public.ranking_positions
FOR SELECT
USING (true);

-- Only service role can insert/update (will be done server-side)
CREATE POLICY "Service role can manage ranking positions"
ON public.ranking_positions
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Create index for faster lookups
CREATE INDEX idx_ranking_positions_level ON public.ranking_positions(level_id);
CREATE INDEX idx_ranking_positions_block ON public.ranking_positions(block_id);