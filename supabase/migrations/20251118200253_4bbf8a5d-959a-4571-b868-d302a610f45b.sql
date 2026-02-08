-- Create user_wallets table to manage multiple wallets per user
CREATE TABLE public.user_wallets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL UNIQUE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_wallet_per_user UNIQUE(user_id, wallet_address)
);

-- Enable RLS
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_wallets
CREATE POLICY "Users can view their own wallets"
  ON public.user_wallets
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own wallets"
  ON public.user_wallets
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    (SELECT COUNT(*) FROM public.user_wallets WHERE user_id = auth.uid()) < 5
  );

CREATE POLICY "Users can delete their own wallets"
  ON public.user_wallets
  FOR DELETE
  USING (auth.uid() = user_id AND is_primary = false);

CREATE POLICY "Users can update their own wallets"
  ON public.user_wallets
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Function to ensure only one primary wallet per user
CREATE OR REPLACE FUNCTION public.ensure_single_primary_wallet()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE public.user_wallets
    SET is_primary = false
    WHERE user_id = NEW.user_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to enforce single primary wallet
CREATE TRIGGER enforce_single_primary_wallet
  BEFORE INSERT OR UPDATE ON public.user_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_single_primary_wallet();

-- Migrate existing wallet_address data from profiles to user_wallets
INSERT INTO public.user_wallets (user_id, wallet_address, is_primary)
SELECT id, wallet_address, true
FROM public.profiles
WHERE wallet_address IS NOT NULL AND wallet_address != '';

-- Update blocks table to track which wallet created the block
ALTER TABLE public.blocks
ADD COLUMN IF NOT EXISTS creator_wallet_address TEXT;

-- Index for better query performance
CREATE INDEX idx_user_wallets_user_id ON public.user_wallets(user_id);
CREATE INDEX idx_blocks_creator_wallet ON public.blocks(creator_wallet_address);