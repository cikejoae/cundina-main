-- Create table for platform wallets (10 rotating wallets for users without referral)
CREATE TABLE public.platform_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position integer NOT NULL CHECK (position >= 1 AND position <= 10),
  wallet_address text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(position)
);

-- Create table to track the current rotation position
CREATE TABLE public.platform_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  updated_at timestamp with time zone DEFAULT now()
);

-- Insert initial rotation counter
INSERT INTO public.platform_config (key, value) VALUES ('current_wallet_position', '1');

-- Create table for admin section permissions (using text for role to avoid enum issues)
CREATE TABLE public.admin_section_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  section text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(role, section)
);

-- Insert default permissions
INSERT INTO public.admin_section_permissions (role, section) VALUES
  ('admin', 'database'),
  ('admin', 'metrics'),
  ('admin', 'marketing'),
  ('admin', 'support'),
  ('admin', 'dao'),
  ('admin', 'config'),
  ('support', 'support'),
  ('marketing', 'marketing'),
  ('dao_manager', 'dao');

-- Enable RLS
ALTER TABLE public.platform_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_section_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for platform_wallets
CREATE POLICY "Admins can view platform wallets"
  ON public.platform_wallets FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage platform wallets"
  ON public.platform_wallets FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- RLS Policies for platform_config
CREATE POLICY "Admins can view platform config"
  ON public.platform_config FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage platform config"
  ON public.platform_config FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- RLS Policies for admin_section_permissions
CREATE POLICY "Admins can view all permissions"
  ON public.admin_section_permissions FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage permissions"
  ON public.admin_section_permissions FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Function to get next platform wallet for rotation
CREATE OR REPLACE FUNCTION public.get_next_platform_wallet()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_pos integer;
  next_pos integer;
  wallet text;
BEGIN
  SELECT value::integer INTO current_pos
  FROM public.platform_config
  WHERE key = 'current_wallet_position';

  SELECT wallet_address INTO wallet
  FROM public.platform_wallets
  WHERE position = current_pos AND is_active = true;

  IF wallet IS NULL THEN
    SELECT wallet_address, position INTO wallet, current_pos
    FROM public.platform_wallets
    WHERE is_active = true
    ORDER BY position
    LIMIT 1;
  END IF;

  next_pos := CASE WHEN current_pos >= 10 THEN 1 ELSE current_pos + 1 END;

  UPDATE public.platform_config
  SET value = next_pos::text, updated_at = now()
  WHERE key = 'current_wallet_position';

  RETURN wallet;
END;
$$;

-- Trigger for updated_at
CREATE TRIGGER update_platform_wallets_updated_at
  BEFORE UPDATE ON public.platform_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_platform_config_updated_at
  BEFORE UPDATE ON public.platform_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();