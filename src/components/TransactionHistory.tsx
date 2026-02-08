import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ExternalLink, DollarSign, ArrowUpRight, ArrowDownRight,
  UserPlus, Loader2, PlusCircle, Users, ChevronDown, ChevronUp
} from "lucide-react";
import { querySubgraph } from "@/lib/subgraph";

interface TransactionHistoryProps {
  userId: string;
  walletAddress?: string;
}

interface ActivityItem {
  id: string;
  type: string;
  label: string;
  sublabel?: string;
  amount: string;
  timestamp: string;
  levelId?: number;
}

// Full query: transactions + user blocks (with their members) + user memberships
const FULL_ACTIVITY_QUERY = `
  query GetUserFullActivity($userId: Bytes!) {
    transactions(
      where: { user: $userId }
      orderBy: timestamp
      orderDirection: desc
      first: 100
    ) {
      id
      type
      amount
      timestamp
      block { id levelId }
    }
    user(id: $userId) {
      level
      registeredAt
      blocks {
        id
        levelId
        createdAt
        members(orderBy: joinedAt, orderDirection: desc) {
          id
          member { id }
          position
          joinedAt
        }
      }
      memberships {
        id
        block { id levelId owner { id } }
        position
        joinedAt
      }
    }
  }
`;

interface SubgraphTx {
  id: string;
  type: string;
  amount: string;
  timestamp: string;
  block: { id: string; levelId: number } | null;
}

interface SubgraphFullResult {
  transactions: SubgraphTx[];
  user: {
    level: number;
    registeredAt: string;
    blocks: {
      id: string;
      levelId: number;
      createdAt: string;
      members: { id: string; member: { id: string }; position: number; joinedAt: string }[];
    }[];
    memberships: {
      id: string;
      block: { id: string; levelId: number; owner: { id: string } };
      position: number;
      joinedAt: string;
    }[];
  } | null;
}

const LEVEL_NAMES = ["Curioso", "Soñador", "Novato", "Aprendiz", "Asesor", "Maestro", "Leyenda"];

const TX_TYPE_ICONS: Record<string, typeof ArrowUpRight> = {
  registration: UserPlus,
  join: ArrowDownRight,
  advance: ArrowUpRight,
  cashout: ArrowUpRight,
  withdraw: ArrowUpRight,
  block_created: PlusCircle,
  member_joined: Users,
  membership: Users,
};

const INITIAL_VISIBLE = 3;

export const TransactionHistory = ({ userId, walletAddress }: TransactionHistoryProps) => {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!walletAddress) return;
    fetchActivity();
  }, [walletAddress]);

  const levelLabel = (levelId: number) => {
    const name = LEVEL_NAMES[levelId - 1];
    return name ? `L${levelId}-${name}` : `Nivel ${levelId}`;
  };

  const formatAmount = (amount: string) => {
    const val = parseFloat(amount);
    if (val === 0) return "";
    const usdt = val / 1e6;
    return `$${usdt.toLocaleString("en-US", { maximumFractionDigits: 0 })} USDT`;
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(parseInt(timestamp) * 1000);
    return date.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const shortenAddr = (addr: string) =>
    `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  const fetchActivity = async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    setExpanded(false);
    try {
      const result = await querySubgraph<SubgraphFullResult>(FULL_ACTIVITY_QUERY, {
        userId: walletAddress.toLowerCase(),
      });

      const items: ActivityItem[] = [];
      const seenTxIds = new Set<string>();
      const userAddr = walletAddress.toLowerCase();

      // 1. Transactions (registration, join, advance, cashout)
      if (result.transactions) {
        for (const tx of result.transactions) {
          seenTxIds.add(tx.id);
          const lvl = tx.block?.levelId;
          let label = "";
          let sublabel: string | undefined;

          switch (tx.type) {
            case "registration":
              label = `Registro en ${lvl ? levelLabel(lvl) : "plataforma"}`;
              break;
            case "join":
              label = lvl ? `Unión a bloque ${levelLabel(lvl)}` : "Unión a bloque";
              break;
            case "advance":
              label = lvl ? `Avance desde ${levelLabel(lvl)}` : "Avance de nivel";
              break;
            case "cashout":
              label = lvl ? `Cashout ${levelLabel(lvl)}` : "Cashout";
              break;
            default:
              label = tx.type;
          }

          items.push({
            id: tx.id,
            type: tx.type,
            label,
            sublabel,
            amount: tx.amount,
            timestamp: tx.timestamp,
            levelId: lvl,
          });
        }
      }

      // 2. Blocks created by user (synthetic if not in transactions)
      if (result.user?.blocks) {
        for (const block of result.user.blocks) {
          const synId = `block-created-${block.id}`;
          items.push({
            id: synId,
            type: "block_created",
            label: `Bloque creado ${levelLabel(block.levelId)}`,
            amount: "0",
            timestamp: block.createdAt,
            levelId: block.levelId,
          });

          // 3. Members who joined THIS user's blocks
          if (block.members) {
            for (const m of block.members) {
              // Skip if member data is missing or is the owner themselves
              if (!m.member?.id) continue;
              if (m.member.id.toLowerCase() === userAddr) continue;
              const memId = `member-joined-${m.id}`;
              items.push({
                id: memId,
                type: "member_joined",
                label: `Nuevo miembro en tu bloque`,
                sublabel: `${shortenAddr(m.member.id)} · ${levelLabel(block.levelId)} · Pos ${m.position}`,
                amount: "0",
                timestamp: m.joinedAt,
                levelId: block.levelId,
              });
            }
          }
        }
      }

      // 4. User's own memberships in other people's blocks
      if (result.user?.memberships) {
        for (const m of result.user.memberships) {
          // Skip if block/owner data is missing or user is the owner
          if (!m.block?.owner?.id) continue;
          if (m.block.owner.id.toLowerCase() === userAddr) continue;
          const memId = `membership-${m.id}`;
          items.push({
            id: memId,
            type: "membership",
            label: `Ingreso a bloque ${levelLabel(m.block.levelId)}`,
            sublabel: `Posición ${m.position}`,
            amount: "0",
            timestamp: m.joinedAt,
            levelId: m.block.levelId,
          });
        }
      }

      // Sort by timestamp descending
      items.sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));

      // Deduplicate by keeping the first occurrence of each id
      const uniqueItems: ActivityItem[] = [];
      const uniqueIds = new Set<string>();
      for (const item of items) {
        if (!uniqueIds.has(item.id)) {
          uniqueIds.add(item.id);
          uniqueItems.push(item);
        }
      }

      setActivities(uniqueItems);
    } catch (err: any) {
      console.error("Error fetching activity:", err);
      setError("No se pudieron cargar las transacciones");
    } finally {
      setLoading(false);
    }
  };

  const isOutgoing = (type: string) => ["join", "registration", "membership"].includes(type);
  const isIncoming = (type: string) => ["advance", "cashout", "withdraw", "member_joined"].includes(type);

  const visibleActivities = expanded ? activities : activities.slice(0, INITIAL_VISIBLE);
  const hasMore = activities.length > INITIAL_VISIBLE;

  if (!walletAddress) {
    return (
      <Card className="p-6 bg-card text-card-foreground">
        <div className="text-center py-8">
          <DollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Conecta tu wallet para ver transacciones</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 md:p-6 bg-card text-card-foreground">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Actividad Reciente</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(`https://sepolia.etherscan.io/address/${walletAddress}`, "_blank")}
        >
          <ExternalLink className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">Etherscan</span>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground text-sm">{error}</p>
          <Button variant="ghost" size="sm" onClick={fetchActivity} className="mt-2">
            Reintentar
          </Button>
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <DollarSign className="w-10 h-10 mx-auto text-muted-foreground opacity-50" />
          <p className="text-muted-foreground text-sm">Sin actividad aún</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleActivities.map((item) => {
            const Icon = TX_TYPE_ICONS[item.type] || DollarSign;
            const outgoing = isOutgoing(item.type);
            const incoming = isIncoming(item.type);
            const amountStr = formatAmount(item.amount);
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className={`p-2 rounded-full shrink-0 ${
                  incoming ? "bg-green-500/10" : outgoing ? "bg-red-500/10" : "bg-primary/10"
                }`}>
                  <Icon className={`w-4 h-4 ${
                    incoming ? "text-green-400" : outgoing ? "text-red-400" : "text-primary"
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                  {item.sublabel && (
                    <p className="text-[11px] text-muted-foreground truncate">{item.sublabel}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatDate(item.timestamp)}</p>
                </div>
                <div className="text-right shrink-0">
                  {amountStr && (
                    <p className={`text-sm font-semibold ${outgoing ? "text-red-400" : "text-green-400"}`}>
                      {outgoing ? "-" : "+"}{amountStr}
                    </p>
                  )}
                  {item.levelId && (
                    <p className="text-[10px] text-muted-foreground">
                      {LEVEL_NAMES[item.levelId - 1] || `L${item.levelId}`}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Show more / less */}
          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="w-full mt-1 text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-4 h-4 mr-1" />
                  Ver menos
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 mr-1" />
                  Ver más ({activities.length - INITIAL_VISIBLE} actividades)
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
};
