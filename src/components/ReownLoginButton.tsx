import { useEffect, useState, useCallback } from "react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";

const ReownLoginButton = () => {
  const { open, close } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { signMessageAsync } = useSignMessage();
  const { signInWithWallet, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  const [requestedConnect, setRequestedConnect] = useState(false);
  const [pendingSignature, setPendingSignature] = useState(false);

  const goPostAuth = useCallback(() => {
    const redirect = localStorage.getItem('postAuthRedirect');
    const ref = searchParams.get('ref') || localStorage.getItem('referralCode');

    if (redirect && !redirect.startsWith('/connect')) {
      localStorage.removeItem('postAuthRedirect');
      navigate(redirect, { replace: true });
      return;
    }

    navigate(ref ? `/dashboard?ref=${ref}` : '/dashboard', { replace: true });
  }, [navigate, searchParams]);

  const requestSignature = useCallback(async (walletAddress: string) => {
    if (pendingSignature || isLoading) return;
    
    setPendingSignature(true);
    setIsLoading(true);
    
    try {
      // Create a message with timestamp for security
      const timestamp = Date.now();
      const message = `Bienvenido a CundinaBlock!\n\nFirma este mensaje para verificar que eres el propietario de esta wallet.\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`;
      
      // Request signature from wallet
      const signature = await signMessageAsync({ 
        message,
        account: walletAddress as `0x${string}`,
      });
      
      // Now authenticate with the signature
      await handleWalletLogin(walletAddress, signature, message);
    } catch (error: any) {
      console.error("Signature error:", error);
      if (error.message?.includes('User rejected') || error.message?.includes('denied')) {
        toast.error("Firma rechazada. Por favor firma el mensaje para continuar.");
      } else {
        toast.error("Error al firmar el mensaje");
      }
      setHasAttemptedLogin(false);
      setRequestedConnect(false);
    } finally {
      setPendingSignature(false);
      setIsLoading(false);
    }
  }, [pendingSignature, isLoading]);

  useEffect(() => {
    // Only continue when user explicitly clicked "Conectar Wallet" and wallet is connected
    if (requestedConnect && isConnected && address && !hasAttemptedLogin && !user && !pendingSignature) {
      setHasAttemptedLogin(true);
      requestSignature(address);
    }
  }, [requestedConnect, isConnected, address, hasAttemptedLogin, user, pendingSignature, requestSignature]);

  const handleWalletLogin = async (walletAddress: string, signature: string, message: string) => {
    try {
      const result = await signInWithWallet(walletAddress, signature, message);
      
      // Close the Reown modal immediately after successful auth
      close?.();
      
      if (result.isNewUser) {
        // Redirect to registration to complete profile
        const ref = searchParams.get('ref') || localStorage.getItem('referralCode');
        navigate(ref ? `/register-form?wallet=${walletAddress}&ref=${ref}` : `/register-form?wallet=${walletAddress}`);
      } else {
        toast.success("¡Sesión iniciada con wallet!");
        setTimeout(() => goPostAuth(), 300);
      }
    } catch (error: any) {
      console.error("Login error:", error);
      close?.();
      toast.error(error.message || "Error al conectar wallet");
      setHasAttemptedLogin(false);
      setRequestedConnect(false);
    }
  };

  const handleOpenModal = () => {
    // If already authenticated, just continue to the intended destination.
    if (user) {
      goPostAuth();
      return;
    }
    setHasAttemptedLogin(false);
    setPendingSignature(false);
    setRequestedConnect(true);
    open?.();
  };

  return (
    <Button
      onClick={handleOpenModal}
      disabled={isLoading}
      className="w-full bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-700 text-primary-foreground font-semibold py-6 rounded-xl text-base h-14"
    >
      {isLoading ? (
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
      ) : (
        <Wallet className="w-5 h-5 mr-2" />
      )}
      {isLoading ? (pendingSignature ? "Firma el mensaje..." : "Conectando...") : "Inicio de sesión"}
    </Button>
  );
};

export default ReownLoginButton;
