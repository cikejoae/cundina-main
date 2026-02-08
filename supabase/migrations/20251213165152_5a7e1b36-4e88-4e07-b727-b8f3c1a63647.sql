-- Allow anyone to view active blocks (for invitation links)
CREATE POLICY "Anyone can view active blocks"
ON public.blocks
FOR SELECT
USING (status = 'active');