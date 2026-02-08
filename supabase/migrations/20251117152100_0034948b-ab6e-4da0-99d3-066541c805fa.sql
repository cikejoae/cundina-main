-- Hacer wallet_address nullable en profiles
ALTER TABLE public.profiles 
ALTER COLUMN wallet_address DROP NOT NULL;

-- Agregar índice para búsquedas por wallet
CREATE INDEX IF NOT EXISTS idx_profiles_wallet_address 
ON public.profiles(wallet_address) 
WHERE wallet_address IS NOT NULL;

-- Agregar constraint para evitar duplicados de wallet
ALTER TABLE public.profiles 
ADD CONSTRAINT unique_wallet_address 
UNIQUE (wallet_address) 
DEFERRABLE INITIALLY DEFERRED;