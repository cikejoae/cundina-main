-- Update handle_new_user to remove the user_level_progress insert (table was dropped)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_referral_code TEXT;
  referrer_wallet_id UUID;
BEGIN
  -- Generate unique referral code for profile
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
  
  -- Automatically assign admin role to core team members
  IF LOWER(NEW.email) IN ('eduardorojas@ecrstudio.co', 'barretteduardo@gmail.com', 'sctijuana@gmail.com', 'adan@soredi.mx') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  
  -- If wallet referral code exists, get the referrer wallet ID
  IF NEW.raw_user_meta_data->>'wallet_referral_code' IS NOT NULL THEN
    SELECT id INTO referrer_wallet_id
    FROM public.user_wallets
    WHERE referral_code = NEW.raw_user_meta_data->>'wallet_referral_code'
    LIMIT 1;
  END IF;
  
  -- If wallet_address exists, create user_wallets entry with referral
  IF NEW.raw_user_meta_data->>'wallet_address' IS NOT NULL AND NEW.raw_user_meta_data->>'wallet_address' != '' THEN
    INSERT INTO public.user_wallets (
      user_id,
      wallet_address,
      referred_by_wallet_id
    )
    VALUES (
      NEW.id,
      NEW.raw_user_meta_data->>'wallet_address',
      referrer_wallet_id
    );
  END IF;
  
  -- NOTE: Level progress is now managed 100% on-chain (V5 contracts)
  -- No longer inserting into user_level_progress table
  
  RETURN NEW;
END;
$function$;

-- Drop handle_new_wallet_progress since user_level_progress table no longer exists
DROP FUNCTION IF EXISTS public.handle_new_wallet_progress() CASCADE;
