-- Add last_trend column to track the most recent trend direction
ALTER TABLE public.ranking_positions 
ADD COLUMN IF NOT EXISTS last_trend TEXT DEFAULT 'same' CHECK (last_trend IN ('up', 'down', 'same', 'new'));