import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft } from "lucide-react";
import { Navigation } from "@/components/Navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useAccount } from "wagmi";
import { toast } from "sonner";

const BlockManager = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { isConnected } = useAccount();
  const [blockIdToJoin, setBlockIdToJoin] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    if (!isConnected) {
      toast.error("Conecta tu billetera primero");
      navigate("/dashboard");
    }
  }, [user, authLoading, isConnected, navigate]);

  const handleCreateBlock = () => {
    // Redirect to dashboard where PaymentCard handles on-chain block creation
    navigate("/dashboard");
  };

  const handleJoinBlock = () => {
    if (!blockIdToJoin.trim()) {
      toast.error("Ingresa la dirección del bloque o código de referido");
      return;
    }
    const target = blockIdToJoin.trim();

    // If it's a contract address, navigate to block detail
    if (target.startsWith('0x')) {
      navigate(`/block/${target}`);
    } else {
      // If it's a referral code, navigate to dashboard with ref param
      navigate(`/dashboard?ref=${target}`);
    }
  };

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
        <div className="max-w-md mx-auto space-y-6">
          {/* Create Block */}
          <Card className="p-6 bg-card text-card-foreground rounded-xl">
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Creá tu cundina block</h2>
              <p className="text-sm text-muted-foreground">
                Crea un nuevo bloque nivel 1 y comienza a invitar miembros
              </p>
              <Button 
                onClick={handleCreateBlock}
                className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-semibold"
              >
                Crear bloque
              </Button>
            </div>
          </Card>

          {/* Join Block */}
          <Card className="p-6 bg-card text-card-foreground rounded-xl">
            <div className="space-y-4">
              <h2 className="text-xl font-bold">Unite a un block existente</h2>
              <p className="text-sm text-muted-foreground">
                Ingresá la dirección del bloque (0x...) o un código de referido.
              </p>
              
              <div className="space-y-3">
                <Input
                  placeholder="0x... o código de referido"
                  value={blockIdToJoin}
                  onChange={(e) => setBlockIdToJoin(e.target.value)}
                  className="bg-card-dark text-card-dark-foreground border-border h-12 rounded-lg"
                />
                <Button 
                  onClick={handleJoinBlock}
                  disabled={!blockIdToJoin.trim()}
                  className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-semibold"
                >
                  Conectar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default BlockManager;
