-- Add block_number column with auto-increment sequence
ALTER TABLE public.blocks ADD COLUMN block_number SERIAL;

-- Create index for fast lookups
CREATE INDEX idx_blocks_block_number ON public.blocks(block_number);

-- Update existing blocks to have sequential numbers based on creation date
WITH numbered_blocks AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as new_number
  FROM public.blocks
)
UPDATE public.blocks 
SET block_number = numbered_blocks.new_number
FROM numbered_blocks 
WHERE blocks.id = numbered_blocks.id;