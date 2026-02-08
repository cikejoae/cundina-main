import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Wallet,
  ExternalLink,
  Search,
  RefreshCw,
  TrendingUp,
  Clock,
  DollarSign,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { querySubgraph } from "@/lib/subgraph";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const SOCCOOP_WALLET = "0x8Ff9Ff7a6D998A73c0147a113060C88818675839";
const COMMISSION_RATE = 0.10; // 10% SocCoop fee
const PAGE_SIZE = 15;

// Query all transactions from the subgraph (these are block interactions that generate commissions)
const ALL_TRANSACTIONS_QUERY = `
  query GetAllTransactions($first: Int!, $skip: Int!) {
    transactions(
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      id
      user {
        id
      }
      type
      amount
      timestamp
      block
    }
  }
`;

interface SubgraphTx {
  id: string;
  user: { id: string };
  type: string;
  amount: string;
  timestamp: string;
  block?: string | null;
}

interface LevelInfo {
  id: number;
  name: string;
  contribution_amount: number;
  advance_contribution: number | null;
}

interface CommissionRecord {
  txHash: string;
  userWallet: string;
  type: string;
  levelId: number;
  levelName: string;
  baseAmount: number;
  commission: number;
  timestamp: number;
  blockAddress: string | null;
}

interface SocCoopStats {
  totalCommissions: number;
  totalCount: number;
  lastPayment: Date | null;
  byType: Record<string, { count: number; amount: number }>;
}

export const SocCoopContributionsSection = () => {
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [stats, setStats] = useState<SocCoopStats>({
    totalCommissions: 0,
    totalCount: 0,
    lastPayment: null,
    byType: {},
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [levels, setLevels] = useState<Map<number, LevelInfo>>(new Map());

  // Fetch levels data for commission calculation
  const fetchLevels = useCallback(async () => {
    const { data } = await supabase.from("levels").select("id, name, contribution_amount, advance_contribution");
    const map = new Map<number, LevelInfo>();
    (data || []).forEach((l) => map.set(l.id, l as LevelInfo));
    return map;
  }, []);

  const fetchTransactions = useCallback(async (levelsMap: Map<number, LevelInfo>) => {
    // Fetch all transactions in batches
    const allTxs: SubgraphTx[] = [];
    let skip = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const result = await querySubgraph<{ transactions: SubgraphTx[] }>(
        ALL_TRANSACTIONS_QUERY,
        { first: batchSize, skip }
      );
      const batch = result.transactions || [];
      allTxs.push(...batch);
      skip += batchSize;
      hasMore = batch.length === batchSize;
    }

    return allTxs;
  }, []);

  // Determine level from transaction type and context
  const getCommissionForTx = useCallback(
    (tx: SubgraphTx, levelsMap: Map<number, LevelInfo>): CommissionRecord | null => {
      // For registration and join: commission is 10% of the level's contribution_amount
      // For advance: commission is 10% of the advance_contribution
      // We need to infer the level — transactions don't directly store it,
      // but the user's level at time of tx can be approximated

      // Since subgraph amounts are stored as BigInt but currently zero in handlers,
      // we calculate from level data. Default to L1 if unknown.
      let levelId = 1;
      let baseAmount = 0;
      let levelName = "L1-Curioso";

      // Try to get level from user's current data or default to L1
      // For registration/join → L1 contribution ($20)
      // For advance → the level they advanced FROM
      if (tx.type === "registration" || tx.type === "join") {
        levelId = 1;
        const level = levelsMap.get(1);
        baseAmount = level?.contribution_amount || 20;
        levelName = level?.name || "L1-Curioso";
      } else if (tx.type === "advance") {
        // Advance transactions: the amount in the tx could tell us the level
        // For now, use the amount stored in the subgraph if available
        const rawAmount = parseFloat(tx.amount);
        if (rawAmount > 0) {
          baseAmount = rawAmount / 1e6; // USDT 6 decimals
        } else {
          // Estimate from L1 advance contribution
          const level = levelsMap.get(1);
          baseAmount = Number(level?.advance_contribution) || 20;
          levelName = level?.name || "L1-Curioso";
        }
        // Try to match the level by contribution amount
        for (const [id, lvl] of levelsMap.entries()) {
          if (Number(lvl.advance_contribution) === baseAmount || lvl.contribution_amount === baseAmount) {
            levelId = id;
            levelName = lvl.name;
            break;
          }
        }
      } else if (tx.type === "cashout") {
        // Cashouts don't generate SocCoop commissions directly
        return null;
      }

      const commission = baseAmount * COMMISSION_RATE;

      return {
        txHash: tx.id,
        userWallet: tx.user.id,
        type: tx.type,
        levelId,
        levelName,
        baseAmount,
        commission,
        timestamp: parseInt(tx.timestamp),
        blockAddress: tx.block || null,
      };
    },
    []
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const levelsMap = await fetchLevels();
      setLevels(levelsMap);

      const txs = await fetchTransactions(levelsMap);

      const records: CommissionRecord[] = [];
      for (const tx of txs) {
        const record = getCommissionForTx(tx, levelsMap);
        if (record && record.commission > 0) {
          records.push(record);
        }
      }

      setCommissions(records);
      setCurrentPage(1);

      // Calculate stats
      const totalCommissions = records.reduce((sum, r) => sum + r.commission, 0);
      const byType: Record<string, { count: number; amount: number }> = {};
      for (const r of records) {
        if (!byType[r.type]) byType[r.type] = { count: 0, amount: 0 };
        byType[r.type].count++;
        byType[r.type].amount += r.commission;
      }

      setStats({
        totalCommissions,
        totalCount: records.length,
        lastPayment: records.length > 0 ? new Date(records[0].timestamp * 1000) : null,
        byType,
      });
    } catch (err) {
      console.error("Error fetching SocCoop commissions:", err);
      setError(err instanceof Error ? err.message : "Error al consultar datos. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [fetchLevels, fetchTransactions, getCommissionForTx]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter + paginate
  const filteredCommissions = commissions.filter(
    (c) =>
      c.userWallet.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.txHash.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filteredCommissions.length / PAGE_SIZE));
  const paginatedCommissions = filteredCommissions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const truncateAddress = (addr: string) => {
    if (!addr) return "-";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case "registration": return "Registro";
      case "join": return "Unión";
      case "advance": return "Avance";
      case "cashout": return "Cashout";
      default: return type;
    }
  };

  const typeVariant = (type: string): "default" | "secondary" | "outline" | "destructive" => {
    switch (type) {
      case "registration": return "default";
      case "join": return "secondary";
      case "advance": return "outline";
      default: return "secondary";
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
        <p className="text-sm text-muted-foreground animate-pulse">Consultando The Graph...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Aportaciones Sociedad Cooperativa</h1>
        <p className="text-muted-foreground">
          Comisiones del 10% generadas por cada interacción con bloques, indexadas desde The Graph
        </p>
      </div>

      {/* SocCoop Wallet Info */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/20 rounded-full">
              <Wallet className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Billetera SocCoop (Sociedad Cooperativa)</p>
              <p className="font-mono text-sm">{SOCCOOP_WALLET}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(`https://sepolia.etherscan.io/address/${SOCCOOP_WALLET}#tokentxns`, "_blank")
              }
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Ver en Etherscan
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-full">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Comisiones</p>
                <p className="text-2xl font-bold">${stats.totalCommissions.toLocaleString("en-US", { maximumFractionDigits: 0 })} USDT</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent/20 rounded-full">
                <TrendingUp className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Transacciones</p>
                <p className="text-2xl font-bold">{stats.totalCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-full">
                <Clock className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Última Comisión</p>
                <p className="text-lg font-medium">
                  {stats.lastPayment
                    ? format(stats.lastPayment, "dd MMM yyyy HH:mm", { locale: es })
                    : "Sin comisiones"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown by type */}
      {Object.keys(stats.byType).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(stats.byType).map(([type, data]) => (
            <Card key={type} className="p-4">
              <div className="flex flex-col gap-1">
                <Badge variant={typeVariant(type)} className="w-fit">{typeLabel(type)}</Badge>
                <p className="text-lg font-bold">${data.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
                <p className="text-xs text-muted-foreground">{data.count} transacciones</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Commissions Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Historial de Comisiones (On-Chain)</CardTitle>
              <CardDescription>
                Cada interacción con bloques genera un 10% de comisión para SocCoop
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por wallet, tx o tipo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-64"
                />
              </div>
              <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredCommissions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No hay comisiones registradas</p>
              <p className="text-sm">
                Las comisiones aparecerán aquí cuando se indexen transacciones en The Graph
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Nivel</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead>Comisión</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>TX</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedCommissions.map((c, idx) => (
                    <TableRow key={`${c.txHash}-${idx}`}>
                      <TableCell className="font-mono text-sm">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="font-mono text-xs p-0 h-auto"
                          onClick={() =>
                            window.open(`https://sepolia.etherscan.io/address/${c.userWallet}`, "_blank")
                          }
                        >
                          {truncateAddress(c.userWallet)}
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={typeVariant(c.type)}>{typeLabel(c.type)}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{c.levelName}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        ${c.baseAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="font-bold text-primary">
                        ${c.commission.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell>
                        {c.timestamp > 0
                          ? format(new Date(c.timestamp * 1000), "dd/MM/yy HH:mm", { locale: es })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            window.open(`https://sepolia.etherscan.io/tx/${c.txHash}`, "_blank")
                          }
                          className="font-mono text-xs"
                        >
                          {truncateAddress(c.txHash)}
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  Mostrando {(currentPage - 1) * PAGE_SIZE + 1}-
                  {Math.min(currentPage * PAGE_SIZE, filteredCommissions.length)} de{" "}
                  {filteredCommissions.length} comisiones
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Anterior
                  </Button>
                  <span className="text-sm font-medium px-2">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    Siguiente
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
