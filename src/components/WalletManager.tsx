import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, Plus, Trash2, Loader2, Copy, Unplug, Link2, Coins, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { USDT_TOKEN_ADDRESS } from "@/config/contracts";
import { useSearchParams } from "react-router-dom";
import { useAccount, usePublicClient, useDisconnect } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { parseAbi, formatUnits, type Address } from "viem";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

interface UserWallet {
  id: string;
  wallet_address: string;
  created_at: string;
}

interface WalletBalance {
  [address: string]: string;
}

export const WalletManager = () => {
  const { user } = useAuth();
  const { address: account, isConnecting } = useAccount();
  const publicClient = usePublicClient();
  const { open: openAppKit } = useAppKit();
  const { disconnect } = useDisconnect();
  const [searchParams] = useSearchParams();
  const [wallets, setWallets] = useState<UserWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingWallet, setAddingWallet] = useState(false);
  const [walletBalances, setWalletBalances] = useState<WalletBalance>({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Deactivated wallets
  const [deactivatedWallets, setDeactivatedWallets] = useState<UserWallet[]>([]);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [reactivatingWallet, setReactivatingWallet] = useState<string | null>(null);

  // Confirmation dialogs state
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [walletToDelete, setWalletToDelete] = useState<{ id: string; address: string } | null>(null);
  
  const referralCode = searchParams.get('ref');

  useEffect(() => {
    if (user) {
      loadWallets();
      loadDeactivatedWallets();
    }
  }, [user]);

  useEffect(() => {
    if (wallets.length > 0 && publicClient) {
      fetchWalletBalances();
    }
  }, [wallets, publicClient]);

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

  const loadDeactivatedWallets = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', false)
        .order('deactivated_at', { ascending: false });

      if (error) throw error;
      setDeactivatedWallets(data || []);
    } catch (error: any) {
      console.error('Error loading deactivated wallets:', error);
    }
  };

  const handleReactivateWallet = async (walletId: string) => {
    if (!user) return;

    // Check if user already has 5 active wallets
    if (wallets.length >= 5) {
      toast.error('Ya tienes 5 wallets activas. Desactiva una antes de reactivar.');
      return;
    }

    try {
      setReactivatingWallet(walletId);

      const { error } = await supabase
        .from('user_wallets')
        .update({ 
          is_active: true, 
          deactivated_at: null 
        })
        .eq('id', walletId)
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success('Wallet reactivada exitosamente');
      await loadWallets();
      await loadDeactivatedWallets();
    } catch (error: any) {
      console.error('Error reactivating wallet:', error);
      toast.error('Error reactivando wallet');
    } finally {
      setReactivatingWallet(null);
    }
  };

  const fetchWalletBalances = async () => {
    if (!publicClient || wallets.length === 0 || !USDT_TOKEN_ADDRESS) return;
    
    setLoadingBalances(true);
    const balances: WalletBalance = {};
    
    try {
      const decimals = await (publicClient as any).readContract({
        address: USDT_TOKEN_ADDRESS as Address,
        abi: ERC20_ABI,
        functionName: "decimals",
      });
      
      for (const wallet of wallets) {
        try {
          const balance = await (publicClient as any).readContract({
            address: USDT_TOKEN_ADDRESS as Address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [wallet.wallet_address as Address],
          });
          balances[wallet.wallet_address.toLowerCase()] = formatUnits(balance, decimals);
        } catch (err) {
          balances[wallet.wallet_address.toLowerCase()] = '0';
        }
      }
      
      setWalletBalances(balances);
    } catch (error) {
      console.error('Error fetching balances:', error);
    } finally {
      setLoadingBalances(false);
    }
  };

  const handleConnectWallet = () => {
    openAppKit();
  };

  const handleAddWallet = async () => {
    if (!user) return;
    
    if (wallets.length >= 5) {
      toast.error('Máximo 5 wallets permitidas por cuenta');
      return;
    }

    try {
      setAddingWallet(true);
      
      // Connect wallet first if not connected
      if (!account) {
        openAppKit();
        return; // Will retry after wallet is connected
      }

      // Check if wallet is already added
      const existingWallet = wallets.find(w => w.wallet_address.toLowerCase() === account.toLowerCase());
      if (existingWallet) {
        toast.error('Esta wallet ya está vinculada a tu cuenta');
        return;
      }

      // Add wallet to database
      const { error } = await supabase
        .from('user_wallets')
        .insert({
          user_id: user.id,
          wallet_address: account
          // NOTE: Referral chain is now tracked on-chain via Registry.referrerOf mapping
          // The referred_by_wallet_id field is preserved in DB schema for legacy data
          // but new registrations don't need it - blockchain is source of truth
        });

      if (error) throw error;

      toast.success('Wallet vinculada exitosamente');
      await loadWallets();
    } catch (error: any) {
      console.error('Error adding wallet:', error);
      toast.error(error.message || 'Error vinculando wallet');
    } finally {
      setAddingWallet(false);
    }
  };

  const openDeleteDialog = (walletId: string, address: string) => {
    if (wallets.length === 1) {
      toast.error('Debes tener al menos una wallet activa');
      return;
    }
    setWalletToDelete({ id: walletId, address });
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!walletToDelete) return;

    try {
      // Soft delete: set is_active = false and deactivated_at
      const { error } = await supabase
        .from('user_wallets')
        .update({
          is_active: false,
          deactivated_at: new Date().toISOString()
        })
        .eq('id', walletToDelete.id)
        .eq('user_id', user!.id);

      if (error) throw error;

      // Clear localStorage wallet/referral state to allow fresh joins with other wallets
      clearWalletLocalStorage();

      toast.success('Wallet desactivada');
      await loadWallets();
      await loadDeactivatedWallets();
    } catch (error: any) {
      console.error('Error deactivating wallet:', error);
      toast.error('Error desactivando wallet');
    } finally {
      setDeleteDialogOpen(false);
      setWalletToDelete(null);
    }
  };

  const handleConfirmDisconnect = () => {
    disconnect();
    setDisconnectDialogOpen(false);
    // Clear localStorage wallet state on disconnect
    clearWalletLocalStorage();
    toast.success('Wallet desconectada');
  };

  // Helper to clear wallet-related localStorage entries
  const clearWalletLocalStorage = () => {
    const keysToRemove = [
      'referralCode',
      'referrerSourceBlockId',
      'referrerSourceWalletId',
      'referrerSourceWalletAddress',
      'postAuthRedirect',
    ];
    keysToRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore storage errors
      }
    });
  };


  const formatBalance = (address: string) => {
    const balance = walletBalances[address.toLowerCase()];
    if (!balance) return null;
    const num = parseFloat(balance);
    if (num === 0) return '0';
    return num.toLocaleString('es-CO', { maximumFractionDigits: 2 });
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Mis Wallets</h3>
          </div>
          <span className="text-sm text-muted-foreground">
            {wallets.length}/5 wallets
          </span>
        </div>

        {/* Current connected wallet status */}
        <div className={`p-3 rounded-lg border ${account ? 'bg-primary/10 border-primary/20' : 'bg-muted/30 border-dashed'}`}>
          {account ? (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Wallet conectada:</span>
                <code className="text-sm font-mono text-primary">
                  {account.slice(0, 6)}...{account.slice(-4)}
                </code>
                {!wallets.find(w => w.wallet_address.toLowerCase() === account.toLowerCase()) && (
                  <span className="text-xs bg-amber-500/20 text-amber-600 px-2 py-0.5 rounded">
                    No agregada
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisconnectDialogOpen(true)}
                className="text-destructive hover:text-destructive"
              >
                <Unplug className="w-4 h-4 mr-1" />
                Desconectar
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Wallet className="w-4 h-4" />
                <span className="text-sm">No hay wallet conectada</span>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={handleConnectWallet}
                disabled={isConnecting}
              >
                {isConnecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Link2 className="w-4 h-4 mr-1" />
                Conectar Wallet
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {wallets.map((wallet) => (
            <div
              key={wallet.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                account?.toLowerCase() === wallet.wallet_address.toLowerCase()
                  ? 'bg-primary/5 border-primary/30'
                  : 'bg-muted/30 border-transparent'
              }`}
            >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-mono truncate">
                      {wallet.wallet_address.slice(0, 6)}...{wallet.wallet_address.slice(-4)}
                    </code>
                    {account?.toLowerCase() === wallet.wallet_address.toLowerCase() && (
                      <span className="text-xs bg-green-500/20 text-green-600 px-2 py-0.5 rounded">
                        Conectada
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <Coins className="w-3 h-3 text-amber-500" />
                      <span className="text-xs font-medium">
                        {loadingBalances ? (
                          <Loader2 className="w-3 h-3 animate-spin inline" />
                        ) : (
                          <span className="text-amber-600">
                            {formatBalance(wallet.wallet_address) ?? '—'} USDT
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openDeleteDialog(wallet.id, wallet.wallet_address)}
                  title="Eliminar wallet"
                  disabled={wallets.length === 1}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {wallets.length < 5 && account && !wallets.find(w => w.wallet_address.toLowerCase() === account.toLowerCase()) && (
          <Button
            onClick={handleAddWallet}
            disabled={addingWallet}
            className="w-full"
            variant="default"
          >
            {addingWallet && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Plus className="w-4 h-4 mr-2" />
            Agregar Wallet Conectada
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          Cada wallet funciona como una cuenta independiente con su propio código de invitación. Cada una debe hacer su aporte de $20 USDT y puede invitar sus propios miembros. Máximo 5 wallets por cuenta.
        </p>
      </Card>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              Esto desconectará tu wallet. Para realizar transacciones deberás conectarla nuevamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDisconnect} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Wallet Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              Esto desactivará la wallet <code className="text-sm bg-muted px-1 rounded">{walletToDelete?.address.slice(0, 6)}...{walletToDelete?.address.slice(-4)}</code>. Podrás reactivarla después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deactivated Wallets Section */}
      {deactivatedWallets.length > 0 && (
        <Card className="p-4 mt-4 border-dashed border-muted-foreground/30">
          <button
            onClick={() => setShowDeactivated(!showDeactivated)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="w-4 h-4" />
              <span className="text-sm font-medium">
                Wallets desactivadas ({deactivatedWallets.length})
              </span>
            </div>
            {showDeactivated ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {showDeactivated && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Estas wallets fueron desactivadas y no aparecen en tu cuenta. Puedes reactivarlas si tienes menos de 5 activas.
              </p>
              {deactivatedWallets.map((wallet) => (
                <div
                  key={wallet.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-dashed"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm font-mono text-muted-foreground">
                        {wallet.wallet_address.slice(0, 6)}...{wallet.wallet_address.slice(-4)}
                      </code>
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                        Desactivada
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReactivateWallet(wallet.id)}
                    disabled={reactivatingWallet === wallet.id || wallets.length >= 5}
                    className="shrink-0"
                  >
                    {reactivatingWallet === wallet.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <RotateCcw className="w-4 h-4 mr-1" />
                        Reactivar
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
};
