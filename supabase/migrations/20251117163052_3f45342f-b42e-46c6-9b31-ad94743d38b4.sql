
-- Fix critical RLS vulnerabilities

-- 1. Fix profiles table - Users can only view their own profile
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- 2. Fix block_members - Only authenticated users who are members can view
DROP POLICY IF EXISTS "Anyone can view block members" ON public.block_members;
CREATE POLICY "Members can view block members"
ON public.block_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.block_members bm
    WHERE bm.block_id = block_members.block_id
    AND bm.user_id = auth.uid()
  )
);

-- 3. Fix user_roles - Users can only view their own roles or if they're admin
DROP POLICY IF EXISTS "Anyone can view user roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id 
  OR public.has_role(auth.uid(), 'admin')
);

-- 4. Fix blocks - Only authenticated users can view blocks
DROP POLICY IF EXISTS "Anyone can view blocks" ON public.blocks;
CREATE POLICY "Authenticated users can view blocks"
ON public.blocks
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- 5. Fix notifications - Only service role can insert (not regular users)
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
CREATE POLICY "Service role can insert notifications"
ON public.notifications
FOR INSERT
TO service_role
WITH CHECK (true);

-- 6. Enable leaked password protection
-- This is done via Supabase dashboard or config, not SQL

-- 7. Fix function search_path for has_role (already set correctly)
-- 8. Fix function search_path for other functions
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    new_code := upper(substring(md5(random()::text) from 1 for 8));
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE referral_code = new_code) INTO code_exists;
    EXIT WHEN NOT code_exists;
  END LOOP;
  RETURN new_code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
