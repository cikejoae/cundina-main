import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wallet, Award, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface WalletInfo {
  id: string;
  wallet_address: string;
  referral_code: string;
}

export const WalletComparison = () => {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadWallets();
    }
  }, [user]);

  const loadWallets = async () => {
    if (!user) return;

    try {
      const { data: walletsData, error } = await supabase
        .from('user_wallets')
        .select('id, wallet_address, referral_code')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setWallets(walletsData || []);
    } catch (error) {
      console.error('Error loading wallets:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 glass border-border">
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Comparativa de Wallets</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (wallets.length === 0) {
    return (
      <Card className="p-6 glass border-border">
        <div className="text-center py-8">
          <Wallet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            No tienes wallets agregadas. Agrega wallets para ver estadísticas comparativas.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 glass border-border">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold">Tus Wallets</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Niveles, bloques y ganancias están 100% on-chain
            </p>
          </div>
          <Badge variant="outline" className="text-sm">
            {wallets.length}/5 Wallets
          </Badge>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {wallets.map((wallet) => (
            <Card
              key={wallet.id}
              className="p-4 space-y-4 transition-all hover:shadow-lg border-border"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Wallet className="w-5 h-5 text-primary" />
                  <Award className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="font-mono text-xs text-muted-foreground truncate">
                    {wallet.wallet_address.slice(0, 8)}...{wallet.wallet_address.slice(-6)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Código: {wallet.referral_code}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => window.open(`https://sepolia.etherscan.io/address/${wallet.wallet_address}`, '_blank')}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                Etherscan
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </Card>
  );
};
