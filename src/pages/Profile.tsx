import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, LogOut, Copy, Share2, Check, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { TransactionHistory } from "@/components/TransactionHistory";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ProfileEditDialog } from "@/components/ProfileEditDialog";
import { LevelBadge } from "@/components/LevelBadge";
import { toast } from "sonner";
import { useOnChainData } from "@/hooks/useOnChainData";
import { useAccount } from "wagmi";

const LEVEL_NAMES = ["Curioso", "Soñador", "Novato", "Aprendiz", "Asesor", "Maestro", "Leyenda"];

const Profile = () => {
  const navigate = useNavigate();
  const { user, signOut, loading: authLoading } = useAuth();
  const { address: account, isConnected } = useAccount();
  const { getReferralCode, getUserLevel, isReady: onChainReady } = useOnChainData();
  
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [walletsCount, setWalletsCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [onChainReferralCode, setOnChainReferralCode] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [userLevel, setUserLevel] = useState<number>(0);

  const REFERRAL_BASE_URL = "https://cundinablock.com/dashboard";

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    fetchProfile();
  }, [user, authLoading, navigate]);

  // Fetch on-chain referral code and level when wallet is connected
  useEffect(() => {
    const fetchOnChainData = async () => {
      if (!onChainReady || !account) {
        setOnChainReferralCode(null);
        setUserLevel(0);
        return;
      }
      
      setReferralLoading(true);
      try {
        const [code, level] = await Promise.all([
          getReferralCode(),
          getUserLevel(),
        ]);
        setOnChainReferralCode(code || null);
        setUserLevel(level || 0);
      } catch (err) {
        console.warn('[Profile] Could not fetch on-chain data:', err);
        setOnChainReferralCode(null);
      } finally {
        setReferralLoading(false);
      }
    };
    
    fetchOnChainData();
  }, [onChainReady, account, getReferralCode, getUserLevel]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .single();

      if (error) throw error;
      setProfile(data);

      const { data: wallets } = await supabase
        .from("user_wallets")
        .select("id")
        .eq("user_id", user!.id)
        .eq("is_active", true);
      
      setWalletsCount(wallets?.length || 0);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const handleAvatarUpdated = (url: string) => {
    setProfile((prev: any) => ({ ...prev, avatar_url: url }));
  };

  const handleProfileUpdated = (data: { full_name: string; phone: string; whatsapp: string | null; telegram: string | null }) => {
    setProfile((prev: any) => ({ ...prev, ...data }));
  };

  const effectiveReferralCode = onChainReferralCode;
  const isBytes32Code = effectiveReferralCode && /^[a-fA-F0-9]{64}$/i.test(effectiveReferralCode);
  const displayReferralCode = isBytes32Code
      ? `${effectiveReferralCode.slice(0, 8)}...${effectiveReferralCode.slice(-4)}`
      : effectiveReferralCode;
  const referralLink = effectiveReferralCode ? `${REFERRAL_BASE_URL}?ref=${effectiveReferralCode}` : null;

  const handleCopyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("¡Enlace copiado!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("No se pudo copiar el enlace");
    }
  };

  const handleCopyCode = async () => {
    if (!effectiveReferralCode) return;
    try {
      await navigator.clipboard.writeText(effectiveReferralCode);
      toast.success("¡Código copiado!");
    } catch (err) {
      toast.error("No se pudo copiar el código");
    }
  };

  const handleShare = async () => {
    if (!referralLink) return;
    const shareData = {
      title: "Únete a CundinaBlock",
      text: "¡Únete a CundinaBlock y comienza a ahorrar de forma colaborativa! Usa mi código de referido.",
      url: referralLink,
    };
    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await handleCopyLink();
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        await handleCopyLink();
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pb-24 flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const levelName = userLevel > 0 ? LEVEL_NAMES[userLevel - 1] || `L${userLevel}` : null;

  return (
    <div className="min-h-screen pb-24 bg-background">
      <Navigation />
      
      <div className="container mx-auto px-4 pt-20">
        <div className="space-y-4">
          {/* Profile Header — avatar, name, phone, level badge */}
          <Card className="p-6 bg-card text-card-foreground rounded-xl relative">
            {/* Level badge — top-right on desktop */}
            {userLevel > 0 && levelName && (
              <div className="absolute top-4 right-4 hidden sm:block">
                <LevelBadge level={userLevel} name={levelName} />
              </div>
            )}

            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center gap-2">
                <ProfileAvatar
                  userId={user!.id}
                  fullName={profile?.full_name || ""}
                  avatarUrl={profile?.avatar_url || null}
                  onAvatarUpdated={handleAvatarUpdated}
                />
                {/* Level badge — below avatar on mobile */}
                {userLevel > 0 && levelName && (
                  <div className="sm:hidden">
                    <LevelBadge level={userLevel} name={levelName} className="text-xs" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <h1 className="text-xl font-bold break-words">{profile?.full_name}</h1>
                <p className="text-sm text-muted-foreground truncate">{profile?.email}</p>
                {profile?.phone && (
                  <p className="text-sm text-muted-foreground mt-1">{profile.phone}</p>
                )}
                {profile?.whatsapp && (
                  <p className="text-xs text-muted-foreground">WA: {profile.whatsapp}</p>
                )}
                {profile?.telegram && (
                  <p className="text-xs text-muted-foreground">TG: {profile.telegram}</p>
                )}
              </div>
            </div>
          </Card>

          {/* Referral Sharing Section */}
          {referralLoading ? (
            <Card className="p-6 bg-card border rounded-xl">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Cargando código de referido...</span>
              </div>
            </Card>
          ) : effectiveReferralCode ? (
            <Card className="p-6 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20 rounded-xl">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-primary" />
                  <h3 className="font-bold text-lg">Invita y Gana</h3>
                </div>
                
                <p className="text-sm text-muted-foreground">
                  Comparte tu código de referido y ayuda a otros a unirse a CundinaBlock.
                </p>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Tu código de referido 
                    {isBytes32Code && (
                      <span className="ml-1 text-primary text-[10px]">(on-chain ✓)</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-card border border-border rounded-lg px-4 py-3 font-mono text-sm font-bold tracking-wider overflow-hidden">
                      <span className="block truncate" title={effectiveReferralCode || undefined}>
                        {displayReferralCode}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyCode}
                      className="h-12 w-12 shrink-0"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Tu enlace de invitación</p>
                  <div className="bg-card border border-border rounded-lg px-4 py-3 text-sm font-mono break-all text-muted-foreground">
                    {referralLink}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleCopyLink} variant="outline" className="flex-1">
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        ¡Copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copiar enlace
                      </>
                    )}
                  </Button>
                  <Button onClick={handleShare} className="flex-1 bg-primary hover:bg-primary/90">
                    <Share2 className="w-4 h-4 mr-2" />
                    Compartir
                  </Button>
                </div>
              </div>
            </Card>
          ) : isConnected ? (
            <Card className="p-6 bg-muted/50 border border-dashed rounded-xl">
              <div className="text-center space-y-3">
                <Share2 className="w-8 h-8 text-muted-foreground mx-auto" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    ¡Crea tu primer bloque para invitar amigos!
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Tu código de referido se generará automáticamente cuando crees tu primer bloque en blockchain.
                  </p>
                </div>
                <Button onClick={() => navigate("/levels")} className="mt-2">
                  Crear mi primer bloque
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-6 bg-muted/50 border border-dashed rounded-xl">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Conecta tu wallet para ver tu código de referido.
                </p>
              </div>
            </Card>
          )}

          <Button 
            onClick={() => navigate("/wallets")}
            variant="outline"
            className="w-full h-12 border-2"
          >
            Gestionar mis wallets ({walletsCount}/5)
          </Button>

          {/* Transaction History */}
          <TransactionHistory userId={user!.id} walletAddress={account} />

          {/* Edit profile button */}
          {profile && (
            <ProfileEditDialog
              userId={user!.id}
              profile={{
                full_name: profile.full_name,
                phone: profile.phone,
                whatsapp: profile.whatsapp,
                telegram: profile.telegram,
              }}
              onProfileUpdated={handleProfileUpdated}
              trigger={
                <Button variant="outline" className="w-full h-12 border-2">
                  <Pencil className="w-4 h-4 mr-2" />
                  Editar perfil
                </Button>
              }
            />
          )}

          <Button 
            onClick={handleLogout}
            variant="outline"
            className="w-full h-12 border-2 border-destructive text-destructive hover:bg-destructive/10"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar Sesión
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Profile;
