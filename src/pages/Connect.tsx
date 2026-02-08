import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, HelpCircle, ArrowLeft } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import WalletTutorialModal from "@/components/WalletTutorialModal";
import ReownLoginButton from "@/components/ReownLoginButton";
import { useAuth } from "@/contexts/AuthContext";

const Connect = () => {
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Get referral code from URL
  const referralCode = searchParams.get('ref') || localStorage.getItem('referralCode');

  const goPostAuth = useCallback(() => {
    const redirect = localStorage.getItem('postAuthRedirect');
    const ref = searchParams.get('ref') || localStorage.getItem('referralCode');

    // Priority: Use stored redirect path (e.g., back to block invitation)
    if (redirect && !redirect.startsWith('/connect')) {
      localStorage.removeItem('postAuthRedirect');
      navigate(redirect, { replace: true });
      return;
    }

    // Default: go to dashboard with referral code if present
    navigate(ref ? `/dashboard?ref=${ref}` : '/dashboard', { replace: true });
  }, [navigate, searchParams]);
  
  // Store referral code in localStorage and clear stale referrer context
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

  // If the user already has a session, skip this screen and go to stored redirect or dashboard.
  useEffect(() => {
    if (user) {
      goPostAuth();
    }
  }, [user, goPostAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 space-y-6 text-center glass border-border">
        <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto glow">
          <Wallet className="w-10 h-10 text-primary" />
        </div>
        
        <div className="space-y-3">
          <h1 className="text-3xl font-bold">Conecta tu Billetera</h1>
          <p className="text-muted-foreground">
            Necesitas una billetera Web3 para comenzar a participar en Cundina Block
          </p>
          {referralCode && (
            <p className="text-sm text-primary">
              Has sido invitado a unirte • Código: {referralCode.slice(0, 8)}...
            </p>
          )}
        </div>

        <div className="space-y-3 pt-4">
          <ReownLoginButton />
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                O continúa con email
              </span>
            </div>
          </div>
          
          <Link to={referralCode ? `/auth?ref=${referralCode}` : '/auth'}>
            <Button 
              variant="outline" 
              className="w-full border-border hover:bg-secondary h-12"
              size="lg"
            >
              Iniciar sesión con Email
            </Button>
          </Link>
          
          <Button 
            variant="ghost" 
            className="w-full text-muted-foreground hover:text-foreground h-12"
            size="lg"
            onClick={() => setShowTutorial(true)}
          >
            <HelpCircle className="w-4 h-4 mr-2" />
            ¿No tienes billetera? Ver Tutorial
          </Button>
        </div>

        <p className="text-xs text-muted-foreground pt-4">
          Al conectar, aceptas nuestros Términos y Condiciones
        </p>
        
        <button
          onClick={() => navigate(-1)}
          className="flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-foreground transition-colors pt-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>
      </Card>

      <WalletTutorialModal open={showTutorial} onOpenChange={setShowTutorial} />
    </div>
  );
};

export default Connect;
