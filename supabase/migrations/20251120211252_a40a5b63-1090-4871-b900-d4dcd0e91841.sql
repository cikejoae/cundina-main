-- Actualizar miembros sin wallet_id para que tengan el wallet_id correcto
-- Esto corrige los datos históricos

-- Primero, actualizar el miembro de Marco Chavez que no tiene wallet_id
UPDATE block_members bm
SET wallet_id = (
  SELECT uw.id 
  FROM user_wallets uw 
  WHERE uw.user_id = bm.user_id 
  AND uw.is_primary = true
  LIMIT 1
)
WHERE bm.wallet_id IS NULL 
AND bm.user_id IS NOT NULL;