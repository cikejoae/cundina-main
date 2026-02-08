import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Wallet, ChevronRight, Info, TrendingUp, TrendingDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";

interface Block {
  id: string;
  block_number: number;
  level_block_number?: number;
  level_id: number;
  creator_id: string;
  current_members: number;
  invited_members_count: number;
  assigned_members_count: number;
  status: string;
  created_at: string;
  creator_wallet_address: string;
  levels: {
    name: string;
    required_members: number;
    contribution_amount: number;
    total_cundina: number;
  };
}

type StatusFilter = 'active' | 'completed' | 'claimed' | 'cancelled';

const statusConfig: Record<StatusFilter, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active: { label: 'Activos', variant: 'default' },
  completed: { label: 'Completados', variant: 'secondary' },
  claimed: { label: 'Reclamados', variant: 'outline' },
  cancelled: { label: 'Cancelados', variant: 'destructive' },
};

interface TrendIndicatorProps {
  trend: 'up' | 'down' | 'same' | 'new';
  diff: number;
}

const TrendIndicator = ({ trend, diff }: TrendIndicatorProps) => {
  if (trend === 'new') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center text-primary">
              <span className="text-[9px] font-bold">NEW</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p>Bloque recién creado</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  if (trend === 'same') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center text-muted-foreground">
              <span className="text-[9px]">—</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p>Sin cambios de posición</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  if (trend === 'up') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center text-success">
              <TrendingUp className="w-3 h-3" />
              {diff > 0 ? (
                <span className="text-[9px] ml-0.5 font-bold">+{diff}</span>
              ) : null}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {diff > 0 ? (
              <p>Subió {diff} {diff === 1 ? 'posición' : 'posiciones'}</p>
            ) : (
              <p>Última tendencia: subió</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center text-destructive">
            <TrendingDown className="w-3 h-3" />
            {diff > 0 ? (
              <span className="text-[9px] ml-0.5 font-bold">-{diff}</span>
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {diff > 0 ? (
            <p>Bajó {diff} {diff === 1 ? 'posición' : 'posiciones'}</p>
          ) : (
            <p>Última tendencia: bajó</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const truncateAddress = (addr: string | null) => {
  if (!addr) return '—';
  return `${addr.slice(0, 4)}...${addr.slice(-3)}`;
};

interface RankingBlockCardProps {
  block: Block;
  position: number;
  isOwner: boolean;
  isMember: boolean;
  trend: 'up' | 'down' | 'same' | 'new';
  diff: number;
  selectedLevel: string;
}

const RankingBlockCard = ({
  block,
  position,
  isOwner,
  isMember,
  trend,
  diff,
  selectedLevel,
}: RankingBlockCardProps) => {
  const navigate = useNavigate();
  const isHighlighted = isOwner || isMember;
  const isInTopRanking = position <= 10;
  const levelId = parseInt(selectedLevel);
  const totalInvited = block.invited_members_count || 0;

  return (
    <Card 
      onClick={() => navigate(`/block/${block.id}`)}
      className={`p-2.5 cursor-pointer transition-colors border relative ${
        isHighlighted 
          ? 'ring-2 ring-primary bg-primary/10 border-primary/50 hover:bg-primary/20' 
          : 'hover:bg-accent/50'
      }`}
    >
      {/* Position badge - only visible for top 10 blocks */}
      {isInTopRanking && (
        <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center ${
          isHighlighted ? 'bg-primary' : 'bg-muted-foreground/80'
        }`}>
          <span className={`text-[10px] font-bold ${
            isHighlighted ? 'text-primary-foreground' : 'text-background'
          }`}>{position}</span>
        </div>
      )}
      
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold">#{block.level_block_number || block.block_number}</span>
          <TrendIndicator trend={trend} diff={diff} />
        </div>
        <Badge 
          variant={statusConfig[block.status as StatusFilter]?.variant || 'secondary'}
          className="text-[10px] h-4 px-1"
        >
          {block.levels.name}
        </Badge>
      </div>
      
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
        <Wallet className="w-3 h-3" />
        <span className="font-mono">{truncateAddress(block.creator_wallet_address)}</span>
      </div>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Users className="w-3 h-3 text-primary" />
          <span className="text-xs font-semibold">
            {block.current_members}/{block.levels.required_members}
          </span>
        </div>
        <span className="text-[10px] font-medium text-primary">
          {block.levels.contribution_amount} USDT
        </span>
      </div>

      {/* Votes & Participants display */}
      <div className="mt-1 space-y-0.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <span># Votos:</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-xs">
                  <p>Participación dentro de la DAO</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <span className="font-semibold text-success">
            {totalInvited}
          </span>
        </div>
        {levelId >= 2 && (
          <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
            <span>Participantes:</span>
            <span className="font-medium">{totalInvited}</span>
          </div>
        )}
      </div>
      
      {/* Role indicator */}
      {isHighlighted && (
        <div className="absolute bottom-1.5 left-1.5">
          <span className="text-xs" title={isOwner ? 'Tu bloque' : 'Eres miembro'}>
            {isOwner ? '🏠' : '👤'}
          </span>
        </div>
      )}
      
      <div className="flex items-center justify-end mt-1">
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
      </div>
    </Card>
  );
};

export default RankingBlockCard;
export type { Block, StatusFilter };
