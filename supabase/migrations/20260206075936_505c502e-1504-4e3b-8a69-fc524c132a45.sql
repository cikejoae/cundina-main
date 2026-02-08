
-- Table to store test wallets for batch testing
CREATE TABLE public.test_wallets (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  private_key TEXT NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  assigned_level INTEGER DEFAULT 0,
  assigned_to_wallet TEXT DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX idx_test_wallets_is_used ON public.test_wallets(is_used);
CREATE INDEX idx_test_wallets_address ON public.test_wallets(address);

-- RLS: only admins can access
ALTER TABLE public.test_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage test wallets"
ON public.test_wallets
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_test_wallets_updated_at
BEFORE UPDATE ON public.test_wallets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
