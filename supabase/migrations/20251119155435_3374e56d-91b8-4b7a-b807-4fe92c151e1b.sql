-- Update RLS policies for wallet-based access

-- user_level_progress: users can view/update progress for their wallets
DROP POLICY IF EXISTS "Users can view their own progress" ON public.user_level_progress;
DROP POLICY IF EXISTS "Users can update their own progress" ON public.user_level_progress;
DROP POLICY IF EXISTS "Users can insert their own progress" ON public.user_level_progress;

CREATE POLICY "Users can view progress for their wallets"
ON public.user_level_progress
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.id = user_level_progress.wallet_id
    AND user_wallets.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update progress for their wallets"
ON public.user_level_progress
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.id = user_level_progress.wallet_id
    AND user_wallets.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert progress for their wallets"
ON public.user_level_progress
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.id = user_level_progress.wallet_id
    AND user_wallets.user_id = auth.uid()
  )
);

-- blocks: users can view/create blocks for their wallets
DROP POLICY IF EXISTS "Users can create blocks" ON public.blocks;
DROP POLICY IF EXISTS "Users can update their own blocks" ON public.blocks;
DROP POLICY IF EXISTS "Users can create blocks for their wallets" ON public.blocks;
DROP POLICY IF EXISTS "Users can update blocks for their wallets" ON public.blocks;

CREATE POLICY "Users can create blocks for their wallets"
ON public.blocks
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.id = blocks.wallet_id
    AND user_wallets.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update blocks for their wallets"
ON public.blocks
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.id = blocks.wallet_id
    AND user_wallets.user_id = auth.uid()
  )
);

-- transactions: wallet-based access
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can create transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can view transactions for their wallets" ON public.transactions;
DROP POLICY IF EXISTS "Users can create transactions for their wallets" ON public.transactions;

CREATE POLICY "Users can view transactions for their wallets"
ON public.transactions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.id = transactions.wallet_id
    AND user_wallets.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create transactions for their wallets"
ON public.transactions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.id = transactions.wallet_id
    AND user_wallets.user_id = auth.uid()
  )
);

-- block_members: wallet-based access
DROP POLICY IF EXISTS "Users can join blocks" ON public.block_members;
DROP POLICY IF EXISTS "Members can view block members" ON public.block_members;
DROP POLICY IF EXISTS "Wallets can join blocks" ON public.block_members;
DROP POLICY IF EXISTS "Users can view block members for their wallets" ON public.block_members;

CREATE POLICY "Wallets can join blocks"
ON public.block_members
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.id = block_members.wallet_id
    AND user_wallets.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view block members for their wallets"
ON public.block_members
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_wallets
    WHERE user_wallets.user_id = auth.uid()
  )
);