import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, userData: any) => Promise<{ error: any; needsEmailVerification: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signInWithWallet: (walletAddress: string, signature: string, message: string) => Promise<{ error: any; isNewUser: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  resendVerificationEmail: (email: string) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, userData: any) => {
    try {
      const redirectUrl = `${window.location.origin}/auth`;
      
      // The database trigger will automatically create the profile and initial progress
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: userData
        }
      });

      if (error) {
        toast.error(error.message);
        return { error, needsEmailVerification: false };
      }

      // Check if email confirmation is required
      if (data?.user && !data.session) {
        // User created but not confirmed - email verification needed
        return { error: null, needsEmailVerification: true };
      }

      return { error: null, needsEmailVerification: false };
    } catch (error: any) {
      console.error('Signup error:', error);
      toast.error('Error al crear cuenta');
      return { error, needsEmailVerification: false };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          toast.error('Email o contraseña inválidos');
        } else {
          toast.error(error.message);
        }
        return { error };
      }

      toast.success('¡Sesión iniciada!');
      return { error: null };
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error('Error al iniciar sesión');
      return { error };
    }
  };

  const signInWithWallet = async (walletAddress: string, signature: string, message: string): Promise<{ error: any; isNewUser: boolean }> => {
    try {
      const normalizedAddress = walletAddress.toLowerCase();
      
      // Call the wallet-auth edge function to verify signature and get session
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wallet-auth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            walletAddress: normalizedAddress,
            signature,
            message,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al verificar wallet');
      }

      if (data.isNewUser) {
        return { error: null, isNewUser: true };
      }

      // User exists - verify the magic link token hash to create session.
      // NOTE: sometimes the backend won't return a usable `token`, but `tokenHash` is enough.
      if (!data.tokenHash) {
        throw new Error('No se pudo crear sesión. Intenta de nuevo.');
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: data.tokenHash,
        type: 'magiclink',
      });

      if (verifyError) {
        console.error('Verify OTP error:', verifyError);
        throw new Error('Error al crear sesión. Por favor intenta de nuevo.');
      }

      return { error: null, isNewUser: false };
    } catch (error: any) {
      console.error('Wallet login error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast.info('Sesión cerrada');
    } catch (error: any) {
      console.error('Logout error:', error);
      toast.error('Error al cerrar sesión');
    }
  };

  const resetPassword = async (email: string) => {
    try {
      // Use the /auth path without hash - Supabase will append the tokens
      const redirectUrl = `${window.location.origin}/auth`;
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl
      });

      if (error) {
        toast.error(error.message);
        return { error };
      }

      return { error: null };
    } catch (error: any) {
      console.error('Reset password error:', error);
      toast.error('Error al enviar el correo de recuperación');
      return { error };
    }
  };

  const resendVerificationEmail = async (email: string) => {
    try {
      const redirectUrl = `${window.location.origin}/auth`;
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: redirectUrl
        }
      });

      if (error) {
        toast.error(error.message);
        return { error };
      }

      toast.success('Email de verificación reenviado');
      return { error: null };
    } catch (error: any) {
      console.error('Resend verification error:', error);
      toast.error('Error al reenviar el email');
      return { error };
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signInWithWallet, signOut, resetPassword, resendVerificationEmail }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
