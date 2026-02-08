-- Step 1: Add columns without constraints
ALTER TABLE public.user_wallets
ADD COLUMN referral_code TEXT,
ADD COLUMN referred_by_wallet_id UUID REFERENCES public.user_wallets(id);

-- Add wallet_id columns to other tables
ALTER TABLE public.user_level_progress
ADD COLUMN wallet_id UUID REFERENCES public.user_wallets(id);

ALTER TABLE public.blocks
ADD COLUMN wallet_id UUID REFERENCES public.user_wallets(id);

ALTER TABLE public.transactions
ADD COLUMN wallet_id UUID REFERENCES public.user_wallets(id);

ALTER TABLE public.block_members
ADD COLUMN wallet_id UUID REFERENCES public.user_wallets(id);

-- Create function to generate referral code for wallets
CREATE OR REPLACE FUNCTION public.generate_wallet_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    new_code := upper(substring(md5(random()::text) from 1 for 8));
    SELECT EXISTS(SELECT 1 FROM public.user_wallets WHERE referral_code = new_code) INTO code_exists;
    EXIT WHEN NOT code_exists;
  END LOOP;
  RETURN new_code;
END;
$$;