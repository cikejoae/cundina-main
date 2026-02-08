-- =====================================================
-- MIGRACIÓN: Usar direcciones de contrato y wallet directamente
-- Eliminamos dependencia de UUIDs internos
-- =====================================================

-- 1. RANKING_POSITIONS: Cambiar block_id UUID por contract_address TEXT
ALTER TABLE public.ranking_positions 
  ADD COLUMN IF NOT EXISTS contract_address TEXT;

-- Migrar datos existentes (si hay)
UPDATE public.ranking_positions rp
SET contract_address = b.contract_address
FROM public.blocks b
WHERE rp.block_id = b.id AND b.contract_address IS NOT NULL;

-- Hacer contract_address NOT NULL después de migrar
-- (solo si hay datos, si no hay datos lo dejamos nullable por ahora)

-- 2. TRANSACTIONS: Agregar contract_address y wallet_address
ALTER TABLE public.transactions 
  ADD COLUMN IF NOT EXISTS contract_address TEXT,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- Migrar datos existentes
UPDATE public.transactions t
SET contract_address = b.contract_address
FROM public.blocks b
WHERE t.block_id = b.id AND b.contract_address IS NOT NULL;

UPDATE public.transactions t
SET wallet_address = uw.wallet_address
FROM public.user_wallets uw
WHERE t.wallet_id = uw.id;

-- 3. USER_LEVEL_PROGRESS: Agregar contract_address y wallet_address
ALTER TABLE public.user_level_progress 
  ADD COLUMN IF NOT EXISTS contract_address TEXT,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- Migrar datos existentes
UPDATE public.user_level_progress ulp
SET contract_address = b.contract_address
FROM public.blocks b
WHERE ulp.block_id = b.id AND b.contract_address IS NOT NULL;

UPDATE public.user_level_progress ulp
SET wallet_address = uw.wallet_address
FROM public.user_wallets uw
WHERE ulp.wallet_id = uw.id;

-- 4. Crear índices para búsquedas eficientes por dirección
CREATE INDEX IF NOT EXISTS idx_ranking_positions_contract_address 
  ON public.ranking_positions(contract_address);

CREATE INDEX IF NOT EXISTS idx_transactions_contract_address 
  ON public.transactions(contract_address);

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_address 
  ON public.transactions(wallet_address);

CREATE INDEX IF NOT EXISTS idx_user_level_progress_contract_address 
  ON public.user_level_progress(contract_address);

CREATE INDEX IF NOT EXISTS idx_user_level_progress_wallet_address 
  ON public.user_level_progress(wallet_address);

-- 5. BLOCK_MEMBERS: Agregar contract_address y wallet_address
-- Esta tabla eventualmente será eliminada (datos vienen del subgraph)
-- pero por ahora la mantenemos para compatibilidad
ALTER TABLE public.block_members 
  ADD COLUMN IF NOT EXISTS contract_address TEXT,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- Migrar datos existentes
UPDATE public.block_members bm
SET contract_address = b.contract_address
FROM public.blocks b
WHERE bm.block_id = b.id AND b.contract_address IS NOT NULL;

UPDATE public.block_members bm
SET wallet_address = uw.wallet_address
FROM public.user_wallets uw
WHERE bm.wallet_id = uw.id;

CREATE INDEX IF NOT EXISTS idx_block_members_contract_address 
  ON public.block_members(contract_address);

CREATE INDEX IF NOT EXISTS idx_block_members_wallet_address 
  ON public.block_members(wallet_address);