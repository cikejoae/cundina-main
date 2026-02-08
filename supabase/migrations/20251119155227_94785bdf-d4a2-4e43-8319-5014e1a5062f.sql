-- First, drop the existing BEFORE trigger that's causing conflicts
DROP TRIGGER IF EXISTS ensure_single_primary_wallet_trigger ON public.user_wallets;

-- Recreate it as AFTER trigger
CREATE OR REPLACE FUNCTION public.ensure_single_primary_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE public.user_wallets
    SET is_primary = false
    WHERE user_id = NEW.user_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_single_primary_wallet_trigger
  AFTER INSERT OR UPDATE ON public.user_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_single_primary_wallet();