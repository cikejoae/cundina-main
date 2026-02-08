import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2, Plus, Trash2, Unplug, Link2, Wallet } from "lucide-react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useDisconnect } from "wagmi";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
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

interface UserWallet {
  id: string;
  wallet_address: string;
  created_at: string;
}

const ManageWallets = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  
  // Reown/Wagmi hooks for wallet management
  const { open } = useAppKit();
  const { address: account, isConnected } = useAppKitAccount();
  const { disconnect, isPending: isDisconnecting } = useDisconnect();
  
  const [wallets, setWallets] = useState<UserWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingWallet, setAddingWallet] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [walletToDelete, setWalletToDelete] = useState<{ id: string; address: string } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    loadWallets();
  }, [user, authLoading, navigate]);

  const loadWallets = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setWallets(data || []);
    } catch (error) {
      console.error('Error loading wallets:', error);
      toast.error('Error cargando wallets');
    } finally {
      setLoading(false);
    }
  };

  const handleAddWallet = async () => {
    if (!user) return;
    
    // Count only active wallets
    if (wallets.length >= 5) {
      toast.error('Máximo 5 wallets activas permitidas por cuenta');
      return;
    }

    try {
      setAddingWallet(true);
      
      if (!account) {
        // Open Reown modal to connect wallet
        open?.();
        setAddingWallet(false);
        return;
      }

      // Check if already in user's active wallets
      const existingActiveWallet = wallets.find(w => w.wallet_address.toLowerCase() === account.toLowerCase());
      if (existingActiveWallet) {
        toast.error('Esta wallet ya está vinculada a tu cuenta');
        return;
      }

      // Check if wallet exists anywhere (active or inactive)
      const { data: existingWallet, error: checkError } = await supabase
        .from('user_wallets')
        .select('id, user_id, is_active, wallet_address')
        .ilike('wallet_address', account)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking wallet:', checkError);
      }

      if (existingWallet) {
        // Wallet exists - check if it belongs to current user (inactive) or another user
        if (existingWallet.user_id === user.id && !existingWallet.is_active) {
          // Reactivate the user's own deactivated wallet
          const { error: reactivateError } = await supabase
            .from('user_wallets')
            .update({ 
              is_active: true, 
              deactivated_at: null 
            })
            .eq('id', existingWallet.id);

          if (reactivateError) throw reactivateError;

          toast.success('Wallet reactivada con todo tu progreso anterior');
          await loadWallets();
          return;
        } else if (existingWallet.user_id !== user.id && !existingWallet.is_active) {
          // Wallet was deactivated by another user - can be claimed
          // First, transfer ownership to current user
          const { error: claimError } = await supabase
            .from('user_wallets')
            .update({ 
              user_id: user.id,
              is_active: true, 
              deactivated_at: null 
            })
            .eq('id', existingWallet.id);

          if (claimError) throw claimError;

          toast.success('Wallet vinculada. Se encontró historial previo asociado.');
          await loadWallets();
          
          // Redirect to levels page
          setTimeout(() => {
            navigate('/levels', { state: { walletAddress: existingWallet.wallet_address } });
          }, 1500);
          return;
        } else if (existingWallet.is_active) {
          // Active wallet belonging to another user
          toast.error('Esta wallet ya está registrada en otra cuenta activa');
          return;
        }
      }

      // New wallet - insert it
      const { data: newWallet, error } = await supabase
        .from('user_wallets')
        .insert({
          user_id: user.id,
          wallet_address: account.toLowerCase(),
          is_active: true
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          toast.error('Esta wallet ya está registrada');
          return;
        }
        throw error;
      }

      toast.success('Wallet vinculada exitosamente');
      await loadWallets();
      
      // Redirect to levels page to make the contribution
      toast.info('Ahora debes hacer tu aporte de 20 USDT para activar esta wallet');
      setTimeout(() => {
        navigate('/levels', { state: { walletAddress: newWallet.wallet_address, newWallet: true } });
      }, 1500);
    } catch (error: any) {
      console.error('Error adding wallet:', error);
      toast.error(error.message || 'Error vinculando wallet');
    } finally {
      setAddingWallet(false);
    }
  };

  const openDeleteDialog = (walletId: string, address: string) => {
    if (wallets.length === 1) {
      toast.error('Debes tener al menos una wallet');
      return;
    }
    setWalletToDelete({ id: walletId, address });
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!walletToDelete || !user) return;

    try {
      // Soft delete: just deactivate the wallet, preserve all data
      const { error } = await supabase
        .from('user_wallets')
        .update({ 
          is_active: false,
          deactivated_at: new Date().toISOString()
        })
        .eq('id', walletToDelete.id)
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success('Wallet desactivada. Puedes reactivarla conectándola de nuevo.');
      await loadWallets();
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
    toast.success('Wallet desconectada');
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
        <div className="container mx-auto flex items-center justify-between">
          <button onClick={() => navigate(-1)}>
            <ChevronLeft className="w-6 h-6" />
          </button>
          <span className="text-sm">{wallets.length}/5 wallets</span>
        </div>
      </div>

      <div className="container mx-auto px-4 pt-32">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Gestiona hasta 5 wallets independientes. Cada una tiene su propio código de invitación y puede participar en bloques separados.
          </p>

          {/* Connected Wallet Status */}
          <Card className={`p-4 ${account ? 'bg-primary/10 border-primary/30' : 'bg-muted/30 border-dashed'}`}>
            {account ? (
              <div className="flex items-center justify-between flex-wrap gap-3">
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
                  className="text-destructive hover:text-destructive border-destructive/50"
                >
                  <Unplug className="w-4 h-4 mr-1" />
                  Desconectar
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Wallet className="w-4 h-4" />
                  <span className="text-sm">No hay wallet conectada</span>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => open?.()}
                >
                  <Link2 className="w-4 h-4 mr-1" />
                  Conectar Wallet
                </Button>
              </div>
            )}
          </Card>

          {/* Wallets List */}
          <div className="space-y-3">
            {wallets.map((wallet) => (
              <Card key={wallet.id} className="p-5 bg-card text-card-foreground rounded-xl">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {wallet.wallet_address.slice(0, 10)}...{wallet.wallet_address.slice(-8)}
                      </span>
                      {account?.toLowerCase() === wallet.wallet_address.toLowerCase() && (
                        <span className="text-xs bg-green-500/20 text-green-600 px-2 py-1 rounded-full font-semibold">
                          Conectada
                        </span>
                      )}
                    </div>
                  </div>


                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openDeleteDialog(wallet.id, wallet.wallet_address)}
                    disabled={wallets.length === 1}
                    className="w-full border-2 border-amber-500 text-amber-600 hover:bg-amber-500/10"
                  >
                    <Unplug className="w-4 h-4 mr-2" />
                    Desactivar wallet
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {/* Add Wallet Button */}
          {wallets.length < 5 && account && !wallets.find(w => w.wallet_address.toLowerCase() === account.toLowerCase()) && (
            <Button
              onClick={handleAddWallet}
              disabled={addingWallet}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-semibold"
            >
              {addingWallet && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Plus className="w-4 h-4 mr-2" />
              Agregar Wallet Conectada ({wallets.length}/5)
            </Button>
          )}

          {/* Info */}
          <Card className="p-4 bg-primary/10 border-2 border-primary rounded-xl">
            <div className="space-y-2">
              <p className="text-sm font-semibold">💡 Importante:</p>
              <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                <li>Cada wallet funciona como cuenta independiente</li>
                <li>Cada wallet debe aportar <strong className="text-primary">20 USDT</strong> al unirse a un bloque</li>
                <li>Los tokens se envían al contrato del bloque (no a otra persona)</li>
                <li>Cada wallet puede invitar miembros con su código único</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              Esto desconectará tu wallet de MetaMask. Para realizar transacciones deberás conectarla nuevamente.
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

      {/* Deactivate Wallet Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar wallet?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Esto desactivará la wallet <code className="text-sm bg-muted px-1 rounded">{walletToDelete?.address.slice(0, 6)}...{walletToDelete?.address.slice(-4)}</code> de tu cuenta.
              </p>
              <p className="text-primary font-medium">
                ✅ Tu progreso de niveles, bloques y membresías se conservarán.
              </p>
              <p className="text-muted-foreground">
                Puedes reactivar esta wallet en cualquier momento conectándola de nuevo.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-amber-500 text-white hover:bg-amber-600">
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ManageWallets;
