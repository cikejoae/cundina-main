-- Allow admins to view all block_members
CREATE POLICY "Admins can view all block members" 
ON public.block_members 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all transactions
CREATE POLICY "Admins can view all transactions" 
ON public.transactions 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all blocks
CREATE POLICY "Admins can view all blocks" 
ON public.blocks 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));