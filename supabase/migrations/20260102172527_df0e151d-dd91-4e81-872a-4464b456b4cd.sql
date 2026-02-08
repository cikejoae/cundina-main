-- Add name field to platform_wallets table
ALTER TABLE public.platform_wallets
ADD COLUMN name text DEFAULT NULL;