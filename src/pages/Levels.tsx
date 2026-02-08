import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { ChevronLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAccount, usePublicClient } from "wagmi";
import { CONTRACTS } from "@/config/contracts";
import { parseAbi } from "viem";

const REGISTRY_ABI = parseAbi([
  "function userLevel(address user) external view returns (uint256)",
]);

interface Level {
  id: number;
  name: string;
  contribution_amount: number;
  required_members: number;
  total_cundina: number;
}

const Levels = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentLevelId, setCurrentLevelId] = useState<number | null>(null);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, account, publicClient]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load all levels (reference data - stays in DB)
      const { data: levelsData, error: levelsError } = await supabase
        .from('levels')
        .select('*')
        .order('sort_order', { ascending: true });

      if (levelsError) throw levelsError;
      setLevels(levelsData || []);

      // Get user's current level from on-chain
      if (account && publicClient) {
        try {
          const level = await (publicClient as any).readContract({
            address: CONTRACTS.REGISTRY,
            abi: REGISTRY_ABI,
            functionName: 'userLevel',
            args: [account],
          });
          const levelNum = Number(BigInt(level || 0));
          setCurrentLevelId(levelNum > 0 ? levelNum : null);
        } catch (err) {
          console.warn('[Levels] Error reading on-chain level:', err);
          setCurrentLevelId(null);
        }
      }
    } catch (error) {
      console.error('Error loading levels:', error);
    } finally {
      setLoading(false);
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
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Progresa en tu camino de Cundina Block y alcanzá nuevas recompensas.
          </p>

          {/* Levels Stack */}
          <div className="space-y-3">
            {[...levels].reverse().map((level, index) => {
              const isLast = index === levels.length - 1;
              const isCurrent = level.id === currentLevelId;
              const isLocked = currentLevelId !== null && level.id > currentLevelId;

              return (
                <Card 
                  key={level.id}
                  className={`p-5 rounded-2xl ${
                    isLast 
                      ? 'bg-muted text-foreground' 
                      : isCurrent
                      ? 'bg-card text-card-foreground border-2 border-primary'
                      : 'bg-card text-card-foreground'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Nivel {level.id}</span>
                      {isCurrent && (
                        <span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded-full font-semibold">
                          Actual
                        </span>
                      )}
                    </div>
                    <h3 className={`text-2xl font-bold ${isCurrent ? 'text-primary' : ''}`}>
                      {level.name}
                    </h3>
                    <p className="text-lg font-mono">
                      {level.contribution_amount.toLocaleString()} USDT
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Info Cards */}
          <Card className="p-5 bg-card text-card-foreground rounded-xl">
            <h3 className="font-bold mb-3">Sobre los niveles</h3>
            <p className="text-sm text-muted-foreground">
              Cada nivel representa una etapa en tu camino de Cundina Block. A medida que avanzás, aumenta el valor de las cundinas y las recompensas potenciales.
            </p>
          </Card>

          <Card className="p-5 bg-primary/10 border-2 border-primary rounded-xl">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💎</span>
              <div>
                <h3 className="font-bold text-primary mb-1">Multiplicador</h3>
                <p className="text-sm text-foreground">
                  Cada nivel multiplica la inversión del nivel anterior, aumentando exponencialmente las oportunidades de crecimiento.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Levels;
