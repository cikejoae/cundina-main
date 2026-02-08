-- Step 2: Add constraints and defaults
ALTER TABLE public.user_wallets
ALTER COLUMN referral_code SET DEFAULT generate_wallet_referral_code();

-- Update existing wallets with referral codes (disable triggers temporarily)
ALTER TABLE public.user_wallets DISABLE TRIGGER ensure_single_primary_wallet_trigger;

DO $$
DECLARE
  wallet_record RECORD;
BEGIN
  FOR wallet_record IN SELECT id FROM public.user_wallets WHERE referral_code IS NULL
  LOOP
    UPDATE public.user_wallets
    SET referral_code = generate_wallet_referral_code()
    WHERE id = wallet_record.id;
  END LOOP;
END $$;

ALTER TABLE public.user_wallets ENABLE TRIGGER ensure_single_primary_wallet_trigger;

-- Now add constraints
ALTER TABLE public.user_wallets
ADD CONSTRAINT user_wallets_referral_code_key UNIQUE (referral_code);

ALTER TABLE public.user_wallets
ALTER COLUMN referral_code SET NOT NULL;

-- Create function to initialize wallet progress (AFTER trigger)
CREATE OR REPLACE FUNCTION public.handle_new_wallet_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create initial level 1 progress for this wallet
  INSERT INTO public.user_level_progress (
    user_id,
    wallet_id,
    level_id,
    status
  )
  VALUES (
    NEW.user_id,
    NEW.id,
    1,
    'locked'
  );
  
  RETURN NEW;
END;
$$;

-- Trigger to create initial progress AFTER insert
CREATE TRIGGER on_wallet_create_progress
  AFTER INSERT ON public.user_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_wallet_progress();