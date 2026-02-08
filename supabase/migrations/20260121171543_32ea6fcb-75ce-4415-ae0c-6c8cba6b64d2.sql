-- Add commission wallet address to platform_config
INSERT INTO public.platform_config (key, value)
VALUES ('commission_wallet_address', '0x0000000000000000000000000000000000000000')
ON CONFLICT (key) DO NOTHING;