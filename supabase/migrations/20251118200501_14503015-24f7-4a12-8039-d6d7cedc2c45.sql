-- Update handle_new_user function to also create user_wallets entry if wallet_address exists
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  new_referral_code TEXT;
BEGIN
  -- Generate unique referral code
  new_referral_code := generate_referral_code();
  
  -- Insert profile with data from auth.users metadata
  INSERT INTO public.profiles (
    id,
    full_name,
    email,
    phone,
    whatsapp,
    telegram,
    wallet_address,
    referred_by,
    referral_code
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, NEW.raw_user_meta_data->>'email', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    NEW.raw_user_meta_data->>'whatsapp',
    NEW.raw_user_meta_data->>'telegram',
    NEW.raw_user_meta_data->>'wallet_address',
    (NEW.raw_user_meta_data->>'referred_by')::uuid,
    new_referral_code
  );
  
  -- If wallet_address exists, create user_wallets entry
  IF NEW.raw_user_meta_data->>'wallet_address' IS NOT NULL AND NEW.raw_user_meta_data->>'wallet_address' != '' THEN
    INSERT INTO public.user_wallets (
      user_id,
      wallet_address,
      is_primary
    )
    VALUES (
      NEW.id,
      NEW.raw_user_meta_data->>'wallet_address',
      true
    );
  END IF;
  
  -- Create initial level progress
  INSERT INTO public.user_level_progress (
    user_id,
    level_id,
    status
  )
  VALUES (
    NEW.id,
    1,
    'locked'
  );
  
  RETURN NEW;
END;
$function$;