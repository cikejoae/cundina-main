-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create enum for block status
CREATE TYPE public.block_status AS ENUM ('active', 'completed', 'cancelled');

-- Create enum for level status
CREATE TYPE public.level_status AS ENUM ('locked', 'active', 'completed');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  telegram TEXT,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by UUID REFERENCES public.profiles(id),
  dao_votes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- Create levels table
CREATE TABLE public.levels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contribution_amount DECIMAL(10, 2) NOT NULL,
  required_members INTEGER NOT NULL,
  total_cundina DECIMAL(10, 2) NOT NULL,
  sort_order INTEGER NOT NULL
);

-- Insert level data
INSERT INTO public.levels (id, name, contribution_amount, required_members, total_cundina, sort_order) VALUES
(1, 'Curioso', 20.00, 9, 162.00, 1),
(2, 'Soñador', 50.00, 8, 360.00, 2),
(3, 'Aprendiz', 100.00, 7, 630.00, 3),
(4, 'Novato', 250.00, 6, 1350.00, 4),
(5, 'Asesor', 500.00, 5, 2250.00, 5),
(6, 'Maestro', 1000.00, 4, 3600.00, 6),
(7, 'Leyenda', 2500.00, 3, 6750.00, 7);

-- Create blocks table
CREATE TABLE public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id INTEGER REFERENCES public.levels(id) NOT NULL,
  creator_id UUID REFERENCES public.profiles(id) NOT NULL,
  status block_status DEFAULT 'active',
  current_members INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Create block_members table
CREATE TABLE public.block_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id UUID REFERENCES public.blocks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  position INTEGER NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(block_id, user_id),
  UNIQUE(block_id, position)
);

-- Create user_level_progress table
CREATE TABLE public.user_level_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  level_id INTEGER REFERENCES public.levels(id) NOT NULL,
  status level_status DEFAULT 'locked',
  block_id UUID REFERENCES public.blocks(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, level_id)
);

-- Create transactions table
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  block_id UUID REFERENCES public.blocks(id),
  tx_hash TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  tx_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.block_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_level_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for user_roles
CREATE POLICY "Anyone can view user roles" ON public.user_roles
  FOR SELECT USING (true);

-- Function to check if user has role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS Policies for levels (public read)
CREATE POLICY "Anyone can view levels" ON public.levels
  FOR SELECT USING (true);

-- RLS Policies for blocks
CREATE POLICY "Anyone can view blocks" ON public.blocks
  FOR SELECT USING (true);

CREATE POLICY "Users can create blocks" ON public.blocks
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Users can update their own blocks" ON public.blocks
  FOR UPDATE USING (auth.uid() = creator_id);

-- RLS Policies for block_members
CREATE POLICY "Anyone can view block members" ON public.block_members
  FOR SELECT USING (true);

CREATE POLICY "Users can join blocks" ON public.block_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for user_level_progress
CREATE POLICY "Users can view their own progress" ON public.user_level_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own progress" ON public.user_level_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own progress" ON public.user_level_progress
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for transactions
CREATE POLICY "Users can view their own transactions" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create transactions" ON public.transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Function to generate unique referral code
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
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
$$;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();