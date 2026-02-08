-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger that fires after user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();