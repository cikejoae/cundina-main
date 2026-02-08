-- Primero eliminar el constraint, luego el índice
ALTER TABLE public.ranking_positions DROP CONSTRAINT IF EXISTS ranking_positions_level_id_block_id_key;

-- Crear nuevo índice único basado en contract_address
CREATE UNIQUE INDEX IF NOT EXISTS ranking_positions_level_contract_unique 
  ON public.ranking_positions(level_id, contract_address) 
  WHERE contract_address IS NOT NULL;