import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Copy, Share2, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOnChainData } from "@/hooks/useOnChainData";
import { useAccount } from "wagmi";
import { toast } from "sonner";

const REFERRAL_BASE_URL = "https://cundinablock.com";

const InviteMembers = () => {
  const navigate = useNavigate();
  const { blockAddress } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { address: account, isConnected } = useAccount();
  const { getReferralCode, isReady: onChainReady } = useOnChainData();

  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
  }, [user, authLoading, navigate]);

  // Fetch on-chain referral code (same source as Profile)
  useEffect(() => {
    const fetchCode = async () => {
      if (!onChainReady || !account) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const code = await getReferralCode();
        setReferralCode(code);
      } catch (err) {
        console.error("[InviteMembers] Error fetching on-chain referral code:", err);
        setReferralCode(null);
      } finally {
        setLoading(false);
      }
    };

    fetchCode();
  }, [onChainReady, account, getReferralCode]);

  const inviteLink = referralCode
    ? blockAddress
      ? `${REFERRAL_BASE_URL}/block/${blockAddress}?ref=${referralCode}`
      : `${REFERRAL_BASE_URL}/dashboard?ref=${referralCode}`
    : null;

  const copyToClipboard = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("¡Enlace copiado al portapapeles!");
    } catch {
      toast.error("Error al copiar el enlace");
    }
  };

  const shareLink = async () => {
    if (!inviteLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Únete a CundinaBlock",
          text: "Podrán unirse utilizando este enlace o tu dirección de billetera.",
          url: inviteLink,
        });
      } catch (error) {
        console.log("Error sharing:", error);
      }
    } else {
      copyToClipboard();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pb-24 flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-background">
      <Navigation />

      {/* Header */}
      <div className="bg-header text-header-foreground p-4 fixed top-16 left-0 right-0 z-10">
        <div className="container mx-auto flex items-center gap-4">
          <button onClick={() => navigate(-1)}>
            <ChevronLeft className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="container mx-auto px-4 pt-32">
        <div className="space-y-6">
          {!isConnected ? (
            <Card className="p-6 bg-muted/50 border border-dashed rounded-xl">
              <div className="text-center space-y-2">
                <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Conecta tu wallet para generar tu enlace de invitación.
                </p>
              </div>
            </Card>
          ) : !referralCode ? (
            <Card className="p-6 bg-muted/50 border border-dashed rounded-xl">
              <div className="text-center space-y-3">
                <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="font-medium text-foreground">
                  ¡Crea tu primer bloque para invitar amigos!
                </p>
                <p className="text-sm text-muted-foreground">
                  Tu código de referido se generará automáticamente cuando crees tu primer bloque en blockchain.
                </p>
                <Button onClick={() => navigate("/levels")} className="mt-2">
                  Crear mi primer bloque
                </Button>
              </div>
            </Card>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Podrán unirse utilizando este enlace o tu dirección de billetera.
              </p>

              {/* Invite Link Card */}
              <Card className="p-5 bg-card text-card-foreground rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex-1 pr-4">
                    <p className="text-sm font-mono break-all">{inviteLink}</p>
                  </div>
                  <button
                    onClick={copyToClipboard}
                    className="flex-shrink-0 p-2 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <Copy className="w-5 h-5" />
                  </button>
                </div>
              </Card>

              {/* Share Button */}
              <Button
                onClick={shareLink}
                variant="outline"
                className="w-full h-12 border-2 rounded-lg flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4" />
                Compartir
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default InviteMembers;
