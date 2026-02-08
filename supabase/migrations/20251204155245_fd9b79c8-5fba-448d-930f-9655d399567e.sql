-- Allow admins to view all profiles
CREATE POLICY "Admins can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all user_wallets
CREATE POLICY "Admins can view all wallets" 
ON public.user_wallets 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to view all user_level_progress
CREATE POLICY "Admins can view all level progress" 
ON public.user_level_progress 
FOR SELECT 
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to manage user_roles (insert, update, delete)
CREATE POLICY "Admins can manage user roles" 
ON public.user_roles 
FOR ALL 
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));