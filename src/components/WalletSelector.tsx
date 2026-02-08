import { useState, useEffect } from "react";
import { Check, ChevronDown, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface UserWallet {
  id: string;
  wallet_address: string;
}

interface WalletSelectorProps {
  selectedWalletId: string | null;
  onWalletChange: (walletId: string) => void;
}

export const WalletSelector = ({ selectedWalletId, onWalletChange }: WalletSelectorProps) => {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<UserWallet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadWallets();
    }
  }, [user]);

  const loadWallets = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setWallets(data || []);
    } catch (error: any) {
      console.error('Error loading wallets:', error);
      toast.error('Error cargando wallets');
    } finally {
      setLoading(false);
    }
  };

  const selectedWallet = wallets.find(w => w.id === selectedWalletId);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Wallet className="w-4 h-4 animate-pulse" />
        <span>Cargando wallets...</span>
      </div>
    );
  }

  if (wallets.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 min-w-[200px] justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            <span className="font-mono text-xs">
              {selectedWallet 
                ? `${selectedWallet.wallet_address.slice(0, 6)}...${selectedWallet.wallet_address.slice(-4)}`
                : "Seleccionar wallet"
              }
            </span>
          </div>
          <ChevronDown className="w-4 h-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px]">
        <DropdownMenuLabel>Seleccionar Wallet ({wallets.length}/5)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {wallets.map((wallet) => (
          <DropdownMenuItem
            key={wallet.id}
            onClick={() => onWalletChange(wallet.id)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">
                  {wallet.wallet_address.slice(0, 8)}...{wallet.wallet_address.slice(-6)}
                </span>
              </div>
            </div>
            {selectedWalletId === wallet.id && (
              <Check className="w-4 h-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
