import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ArrowLeft, HelpCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";
import WalletTutorialModal from "@/components/WalletTutorialModal";
import ReownLoginButton from "@/components/ReownLoginButton";

type AuthView = 'login' | 'forgot-password' | 'reset-password';

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, signIn, resetPassword } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingToken, setIsCheckingToken] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [view, setView] = useState<AuthView>('login');
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    // Listen for PASSWORD_RECOVERY event from Supabase
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setView("reset-password");
        setIsCheckingToken(false);
      }
    });

    // Check for recovery tokens in URL (both hash and query params)
    const checkResetToken = async () => {
      // Check hash parameters (older format)
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const hashType = hashParams.get("type");
      const hashAccessToken = hashParams.get("access_token");
      const hashRefreshToken = hashParams.get("refresh_token");
      const hashErrorCode = hashParams.get("error_code") || hashParams.get("error");
      const hashErrorDescription = hashParams.get("error_description");

      // Check query parameters (newer format)
      const queryParams = new URLSearchParams(window.location.search);
      const queryType = queryParams.get("type");
      const queryCode = queryParams.get("code");
      const queryErrorCode = queryParams.get("error_code") || queryParams.get("error");
      const queryErrorDescription = queryParams.get("error_description");

      // Handle error in URL first (hash or query)
      if (hashErrorCode || hashErrorDescription || queryErrorCode || queryErrorDescription) {
        const rawDesc = queryErrorDescription || hashErrorDescription;
        toast({
          title: "Enlace inválido o expirado",
          description: rawDesc
            ? decodeURIComponent(rawDesc)
            : "El enlace ha expirado o ya fue usado. Solicita uno nuevo.",
          variant: "destructive",
        });

        setView("forgot-password");
        window.history.replaceState({}, document.title, window.location.pathname);
        setIsCheckingToken(false);
        return;
      }

      // Handle hash-based recovery (legacy)
      if (hashType === 'recovery' && hashAccessToken) {
        try {
          const { error } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken || '',
          });
          
          if (!error) {
            setView('reset-password');
            window.history.replaceState({}, document.title, window.location.pathname);
          } else {
            console.error('Error setting session:', error);
            toast({
              title: "Error",
              description: "El enlace ha expirado o es inválido. Solicita uno nuevo.",
              variant: "destructive",
            });
          }
        } catch (err) {
          console.error('Error processing recovery:', err);
          toast({
            title: "Error",
            description: "Error procesando el enlace de recuperación",
            variant: "destructive",
          });
        }
        setIsCheckingToken(false);
        return;
      }
      
      // Handle code-based recovery (PKCE flow - newer)
      if (queryType === 'recovery' && queryCode) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(queryCode);
          if (!error && data.session) {
            setView('reset-password');
            window.history.replaceState({}, document.title, window.location.pathname);
          } else {
            console.error('Error exchanging code:', error);
            toast({
              title: "Enlace expirado",
              description: "El enlace de recuperación ha expirado o ya fue usado. Solicita uno nuevo.",
              variant: "destructive",
            });
          }
        } catch (err) {
          console.error('Error processing recovery:', err);
          toast({
            title: "Error",
            description: "Error procesando el enlace de recuperación",
            variant: "destructive",
          });
        }
        setIsCheckingToken(false);
        return;
      }

      setIsCheckingToken(false);
    };
    
    checkResetToken();

    return () => subscription.unsubscribe();
  }, [toast]);

  // Get referral code from URL params
  const referralCode = searchParams.get('ref');

  useEffect(() => {
    if (referralCode) {
      const storedRef = localStorage.getItem('referralCode');
      if (storedRef !== referralCode) {
        localStorage.removeItem('referrerSourceWalletAddress');
        localStorage.removeItem('referrerSourceBlockId');
      }
      localStorage.setItem('referralCode', referralCode);
    }
  }, [referralCode]);

  useEffect(() => {
    if (user && view === 'login') {
      const ref = referralCode || localStorage.getItem('referralCode');
      navigate(ref ? `/dashboard?ref=${ref}` : "/dashboard");
    }
  }, [user, navigate, view, referralCode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: "Error",
        description: "Por favor completa todos los campos",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    const { error } = await signIn(email, password);
    
    if (error) {
      let errorMessage = error.message;
      
      if (error.message.includes('Email not confirmed')) {
        errorMessage = 'Tu email no ha sido verificado. Revisa tu bandeja de entrada y confirma tu cuenta.';
      }
      
      toast({
        title: "Error al iniciar sesión",
        description: errorMessage,
        variant: "destructive",
      });
      setIsLoading(false);
    } else {
      toast({
        title: "Bienvenido",
        description: "Sesión iniciada correctamente",
      });
      const ref = referralCode || localStorage.getItem('referralCode');
      navigate(ref ? `/dashboard?ref=${ref}` : "/dashboard");
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      toast({
        title: "Error",
        description: "Por favor ingresa tu correo electrónico",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    const { error } = await resetPassword(email);
    setIsLoading(false);
    
    if (!error) {
      toast({
        title: "Correo enviado",
        description: "Revisa tu bandeja de entrada para restablecer tu contraseña",
      });
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password || !confirmPassword) {
      toast({
        title: "Error",
        description: "Por favor completa todos los campos",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Las contraseñas no coinciden",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Error",
        description: "La contraseña debe tener al menos 6 caracteres",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({ password });
      
      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Contraseña actualizada",
          description: "Tu contraseña ha sido cambiada exitosamente. Inicia sesión con tu nueva contraseña.",
        });
        await supabase.auth.signOut();
        window.location.hash = '';
        setView('login');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (error: any) {
      console.error('Error updating password:', error);
      toast({
        title: "Error",
        description: "Error al actualizar la contraseña. Intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const renderLoginForm = () => (
    <>
      {/* Reown Wallet Connect Button */}
      <div className="space-y-4">
        <ReownLoginButton />
        
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              O continúa con email
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleLogin} className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              className="h-12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className="h-12"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setView('forgot-password')}
            className="text-sm text-primary hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        <Button 
          type="submit"
          disabled={isLoading}
          className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
        >
          {isLoading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          Iniciar sesión con Email
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        ¿No tienes cuenta?{" "}
        <Link 
          to="/register-form" 
          className="text-primary hover:underline font-medium"
        >
          Regístrate aquí
        </Link>
      </p>

      <button
        onClick={() => setShowTutorial(true)}
        className="flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-primary transition-colors"
      >
        <HelpCircle className="w-4 h-4" />
        ¿No tienes billetera? Ver Tutorial
      </button>

      <WalletTutorialModal open={showTutorial} onOpenChange={setShowTutorial} />
    </>
  );

  const renderForgotPasswordForm = () => (
    <>
      <div className="text-center space-y-2 mb-6">
        <h2 className="text-2xl font-bold">Recuperar contraseña</h2>
        <p className="text-muted-foreground text-sm">
          Ingresa tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña
        </p>
      </div>

      <form onSubmit={handleForgotPassword} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            type="email"
            placeholder="tu@correo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            className="h-12"
          />
        </div>

        <Button 
          type="submit"
          disabled={isLoading}
          className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
        >
          {isLoading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          Enviar enlace de recuperación
        </Button>
      </form>

      <button
        onClick={() => setView('login')}
        className="flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al inicio de sesión
      </button>
    </>
  );

  const renderResetPasswordForm = () => (
    <>
      <div className="text-center space-y-2 mb-6">
        <h2 className="text-2xl font-bold">Nueva contraseña</h2>
        <p className="text-muted-foreground text-sm">
          Ingresa tu nueva contraseña
        </p>
      </div>

      <form onSubmit={handleResetPassword} className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Nueva contraseña</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className="h-12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar contraseña</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              className="h-12"
            />
          </div>
        </div>

        <Button 
          type="submit"
          disabled={isLoading}
          className="w-full h-14 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
        >
          {isLoading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          Cambiar contraseña
        </Button>
      </form>
    </>
  );

  if (isCheckingToken) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Verificando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex justify-center mb-12">
          <img src={logo} alt="CundinaBlock" className="w-24 h-24" />
        </div>

        {view === 'login' && renderLoginForm()}
        {view === 'forgot-password' && renderForgotPasswordForm()}
        {view === 'reset-password' && renderResetPasswordForm()}

        {/* Terms */}
        {view === 'login' && (
          <p className="text-center text-xs text-muted-foreground mt-4">
            Al iniciar sesión, aceptas nuestros Términos y Condiciones
          </p>
        )}
      </div>
    </div>
  );
};

export default Auth;
