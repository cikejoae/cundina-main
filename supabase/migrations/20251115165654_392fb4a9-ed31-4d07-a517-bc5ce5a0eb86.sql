-- Add contract_address column to blocks table
ALTER TABLE public.blocks 
ADD COLUMN contract_address TEXT;

-- Add index for faster lookups
CREATE INDEX idx_blocks_contract_address ON public.blocks(contract_address);

-- Add comment
COMMENT ON COLUMN public.blocks.contract_address IS 'Ethereum contract address of the CundinaBlock';