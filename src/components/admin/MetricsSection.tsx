import { useState, useEffect, useCallback, useMemo } from "react";
import { TrendingUp, Users, DollarSign, Vote, Boxes, RefreshCw, ArrowUpRight, ArrowDownRight, Minus, Percent, Landmark } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { querySubgraph } from "@/lib/subgraph";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

// ─── Constants ───────────────────────────────────────────

const LEVEL_NAMES: Record<number, string> = {
  1: "Curioso", 2: "Soñador", 3: "Novato", 4: "Aprendiz", 5: "Asesor", 6: "Maestro", 7: "Leyenda",
};
const LEVEL_COLORS: Record<number, string> = {
  1: "#8b5cf6", 2: "#06b6d4", 3: "#22c55e", 4: "#eab308", 5: "#f97316", 6: "#ef4444", 7: "#ec4899",
};

type ChartPeriod = "day" | "week" | "month" | "year";

const PERIOD_OPTIONS: { key: ChartPeriod; label: string }[] = [
  { key: "day", label: "Día" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
  { key: "year", label: "Año" },
];

// ─── Subgraph Queries ────────────────────────────────────

const BLOCKS_STATS_QUERY = `
  query GetBlocksStats {
    blocks(first: 1000) { id status invitedCount createdAt completedAt levelId }
  }
`;
const TRANSACTIONS_STATS_QUERY = `
  query GetTransactionsStats {
    transactions(first: 1000, orderBy: timestamp, orderDirection: desc) { id type amount timestamp }
  }
`;
const USERS_LEVELS_QUERY = `
  query GetUsersLevels {
    users(first: 1000) { id level }
  }
`;

// ─── Types ───────────────────────────────────────────────

interface SubgraphBlockStat { id: string; status: number; invitedCount: number; createdAt: string; completedAt: string | null; levelId: number; }
interface SubgraphTxStat { id: string; type: string; amount: string; timestamp: string; }
interface SubgraphUserLevel { id: string; level: number; }

interface VotesByLevelData { level: string; levelId: number; votes: number; users: number; color: string; }

interface TrendInfo { label: string; value: string; positive: boolean | null; }

interface BucketedPoint { label: string; start: number; end: number; }

// ─── Utility: Time Bucketing ─────────────────────────────

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function getTimeBuckets(period: ChartPeriod): BucketedPoint[] {
  const now = new Date();
  const buckets: BucketedPoint[] = [];

  if (period === "day") {
    // 7 days (today + 6 previous)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const start = d.getTime() / 1000;
      const end = start + 86400;
      const label = i === 0 ? "Hoy" : i === 1 ? "Ayer" : `${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
      buckets.push({ label, start, end });
    }
  } else if (period === "week") {
    // 4 weeks
    for (let i = 3; i >= 0; i--) {
      const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
      const weekStart = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate() - 6);
      const start = Math.floor(weekStart.getTime() / 1000);
      const end = Math.floor(weekEnd.getTime() / 1000) + 86400;
      const label = i === 0 ? "Esta semana" : `Sem ${4 - i}`;
      buckets.push({ label, start, end });
    }
  } else if (period === "month") {
    // 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const start = Math.floor(d.getTime() / 1000);
      const end = Math.floor(nextMonth.getTime() / 1000);
      buckets.push({ label: MONTH_NAMES[d.getMonth()], start, end });
    }
  } else {
    // Year: last 3 years + current
    const currentYear = now.getFullYear();
    for (let y = currentYear - 3; y <= currentYear; y++) {
      const start = Math.floor(new Date(y, 0, 1).getTime() / 1000);
      const end = Math.floor(new Date(y + 1, 0, 1).getTime() / 1000);
      buckets.push({ label: String(y), start, end });
    }
  }

  return buckets;
}

function getTimestampSeconds(tx: SubgraphTxStat): number {
  return parseInt(tx.timestamp);
}

function getCreatedAtSeconds(dateStr: string | null): number {
  if (!dateStr) return 0;
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

// ─── Trend Calculation ───────────────────────────────────

const TREND_PERIODS = [
  { seconds: 86400, label: "24h" },
  { seconds: 604800, label: "7d" },
  { seconds: 2592000, label: "30d" },
] as const;

function calcTrend(
  txs: SubgraphTxStat[],
  blocks: SubgraphBlockStat[],
  profiles: { created_at: string | null }[],
  metric: "members" | "blocks" | "contributions" | "transactions" | "advances" | "commissions" | "activation",
  levelsMap: Map<number, { contribution: number; advance: number }>,
  periodSeconds: number,
  periodLabel: string
): TrendInfo {
  const now = Math.floor(Date.now() / 1000);
  const periodStart = now - periodSeconds;
  const prevPeriodStart = periodStart - periodSeconds;

  let current = 0, previous = 0;

  if (metric === "members") {
    const nowMs = Date.now();
    const periodMs = periodSeconds * 1000;
    current = profiles.filter((p) => p.created_at && new Date(p.created_at).getTime() >= nowMs - periodMs).length;
    previous = profiles.filter((p) => {
      if (!p.created_at) return false;
      const t = new Date(p.created_at).getTime();
      return t >= nowMs - periodMs * 2 && t < nowMs - periodMs;
    }).length;
  } else if (metric === "blocks") {
    current = blocks.filter((b) => parseInt(b.createdAt) >= periodStart).length;
    previous = blocks.filter((b) => { const t = parseInt(b.createdAt); return t >= prevPeriodStart && t < periodStart; }).length;
  } else if (metric === "advances") {
    const completed = blocks.filter((b) => b.status === 1 && b.completedAt);
    current = completed.filter((b) => parseInt(b.completedAt!) >= periodStart).length;
    previous = completed.filter((b) => { const t = parseInt(b.completedAt!); return t >= prevPeriodStart && t < periodStart; }).length;
  } else if (metric === "transactions") {
    current = txs.filter((tx) => parseInt(tx.timestamp) >= periodStart).length;
    previous = txs.filter((tx) => { const t = parseInt(tx.timestamp); return t >= prevPeriodStart && t < periodStart; }).length;
  } else if (metric === "contributions") {
    const calcAmt = (list: SubgraphTxStat[]) => {
      let total = 0;
      for (const tx of list) {
        const raw = parseFloat(tx.amount);
        if (raw > 0) total += raw / 1e6;
        else if (tx.type === "registration" || tx.type === "join") total += levelsMap.get(1)?.contribution || 20;
        else if (tx.type === "advance") total += levelsMap.get(1)?.advance || 20;
      }
      return total;
    };
    current = calcAmt(txs.filter((tx) => parseInt(tx.timestamp) >= periodStart));
    previous = calcAmt(txs.filter((tx) => { const t = parseInt(tx.timestamp); return t >= prevPeriodStart && t < periodStart; }));
  } else if (metric === "commissions") {
    const calcCommission = (list: SubgraphTxStat[]) => {
      let total = 0;
      for (const tx of list) {
        const raw = parseFloat(tx.amount);
        if (raw > 0) total += (raw / 1e6) * 0.1;
        else if (tx.type === "registration" || tx.type === "join") total += (levelsMap.get(1)?.contribution || 20) * 0.1;
        else if (tx.type === "advance") total += (levelsMap.get(1)?.advance || 20) * 0.1;
      }
      return total;
    };
    current = calcCommission(txs.filter((tx) => parseInt(tx.timestamp) >= periodStart));
    previous = calcCommission(txs.filter((tx) => { const t = parseInt(tx.timestamp); return t >= prevPeriodStart && t < periodStart; }));
  } else if (metric === "activation") {
    // Count unique users with join/advance activity in each period
    const currentActive = new Set(txs.filter((tx) => (tx.type === "join" || tx.type === "advance") && parseInt(tx.timestamp) >= periodStart).map((tx) => tx.id)).size;
    const previousActive = new Set(txs.filter((tx) => { const t = parseInt(tx.timestamp); return (tx.type === "join" || tx.type === "advance") && t >= prevPeriodStart && t < periodStart; }).map((tx) => tx.id)).size;
    current = currentActive;
    previous = previousActive;
  }

  if (previous === 0 && current === 0) return { label: periodLabel, value: "0%", positive: null };
  if (previous === 0) return { label: periodLabel, value: "+100%", positive: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { label: periodLabel, value: `${pct >= 0 ? "+" : ""}${pct}%`, positive: pct > 0 ? true : pct < 0 ? false : null };
}

// ─── Period Selector Component ───────────────────────────

const PeriodSelector = ({ value, onChange }: { value: ChartPeriod; onChange: (v: ChartPeriod) => void }) => (
  <div className="flex gap-1">
    {PERIOD_OPTIONS.map((opt) => (
      <button
        key={opt.key}
        onClick={() => onChange(opt.key)}
        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
          value === opt.key
            ? "bg-primary text-primary-foreground"
            : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

// ─── Tooltip Style (shared) ─────────────────────────────

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
};

// ─── Main Component ─────────────────────────────────────

export const MetricsSection = () => {
  // Raw data
  const [rawProfiles, setRawProfiles] = useState<{ id: string; dao_votes: number | null; created_at: string | null; wallet_address: string | null }[]>([]);
  const [rawTxs, setRawTxs] = useState<SubgraphTxStat[]>([]);
  const [rawBlocks, setRawBlocks] = useState<SubgraphBlockStat[]>([]);
  const [rawUsers, setRawUsers] = useState<SubgraphUserLevel[]>([]);
  const [levelsMap, setLevelsMap] = useState<Map<number, { contribution: number; advance: number }>>(new Map());

  // Stats
  const [stats, setStats] = useState({ totalMembers: 0, totalVotes: 0, totalBlocks: 0, activeBlocks: 0, completedBlocks: 0, totalTransactions: 0, totalContributions: 0, totalAdvances: 0, totalCommissions: 0, activationRate: 0 });
  const [trends, setTrends] = useState<Record<string, TrendInfo[]>>({});
  const [loading, setLoading] = useState(true);

  // Per-chart period state
  const [membersPeriod, setMembersPeriod] = useState<ChartPeriod>("day");
  const [txPeriod, setTxPeriod] = useState<ChartPeriod>("day");
  const [contribPeriod, setContribPeriod] = useState<ChartPeriod>("day");
  const [commissionsPeriod, setCommissionsPeriod] = useState<ChartPeriod>("day");

  // ── Fetch ──────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesRes, blocksRes, txsRes, usersRes] = await Promise.all([
        supabase.from("profiles").select("id, dao_votes, created_at, wallet_address", { count: "exact" }),
        querySubgraph<{ blocks: SubgraphBlockStat[] }>(BLOCKS_STATS_QUERY).catch(() => ({ blocks: [] as SubgraphBlockStat[] })),
        querySubgraph<{ transactions: SubgraphTxStat[] }>(TRANSACTIONS_STATS_QUERY).catch(() => ({ transactions: [] as SubgraphTxStat[] })),
        querySubgraph<{ users: SubgraphUserLevel[] }>(USERS_LEVELS_QUERY).catch(() => ({ users: [] as SubgraphUserLevel[] })),
      ]);

      const profiles = profilesRes.data || [];
      const blocks = blocksRes.blocks || [];
      const txs = txsRes.transactions || [];
      const users = usersRes.users || [];

      setRawProfiles(profiles);
      setRawTxs(txs);
      setRawBlocks(blocks);
      setRawUsers(users);

      const totalMembers = profilesRes.count || 0;
      const totalVotes = profiles.reduce((sum, p) => sum + (p.dao_votes || 0), 0);

      const { data: levelsData } = await supabase.from("levels").select("id, contribution_amount, advance_contribution");
      const lMap = new Map<number, { contribution: number; advance: number }>();
      (levelsData || []).forEach((l) => {
        lMap.set(l.id, { contribution: l.contribution_amount, advance: Number(l.advance_contribution) || l.contribution_amount });
      });
      setLevelsMap(lMap);

      const activeBlocks = blocks.filter((b) => b.status === 0).length;
      const completedBlocks = blocks.filter((b) => b.status === 1).length;

      let totalContributions = 0;
      for (const tx of txs) {
        const raw = parseFloat(tx.amount);
        if (raw > 0) totalContributions += raw / 1e6;
        else if (tx.type === "registration" || tx.type === "join") totalContributions += lMap.get(1)?.contribution || 20;
        else if (tx.type === "advance") totalContributions += lMap.get(1)?.advance || 20;
      }

      // Commissions = 10% of total contributions (SocCoop fee)
      const totalCommissions = totalContributions * 0.1;

      const totalAdvances = blocks.filter((b) => b.status === 1 && b.completedAt).length;

      // Activation rate: users with at least one join tx / total registered
      const uniqueActiveUsers = new Set(txs.filter((tx) => tx.type === "join" || tx.type === "advance").map((tx) => tx.id));
      const activationRate = totalMembers > 0 ? Math.round((uniqueActiveUsers.size / totalMembers) * 100) : 0;

      const newTrends: Record<string, TrendInfo[]> = {};
      for (const metric of ["members", "blocks", "contributions", "transactions", "advances", "commissions", "activation"] as const) {
        newTrends[metric] = TREND_PERIODS.map((p) => calcTrend(txs, blocks, profiles, metric, lMap, p.seconds, p.label));
      }
      setTrends(newTrends);

      setStats({ totalMembers, totalVotes, totalBlocks: blocks.length, activeBlocks, completedBlocks, totalTransactions: txs.length, totalContributions, totalAdvances, totalCommissions, activationRate });
    } catch (error) {
      console.error("Error fetching metrics:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Bucketed Chart Data (memoized) ─────────────────────

  const membersChartData = useMemo(() => {
    const buckets = getTimeBuckets(membersPeriod);
    return buckets.map((b) => ({
      label: b.label,
      count: rawProfiles.filter((p) => {
        const t = getCreatedAtSeconds(p.created_at);
        return t >= b.start && t < b.end;
      }).length,
    }));
  }, [rawProfiles, membersPeriod]);

  const txChartData = useMemo(() => {
    const buckets = getTimeBuckets(txPeriod);
    return buckets.map((b) => {
      const txInRange = rawTxs.filter((tx) => {
        const t = getTimestampSeconds(tx);
        return t >= b.start && t < b.end;
      });
      // Advances derived from completed blocks (completedAt timestamp)
      const advancesInRange = rawBlocks.filter((bl) => {
        if (bl.status !== 1 || !bl.completedAt) return false;
        const t = parseInt(bl.completedAt);
        return t >= b.start && t < b.end;
      }).length;
      return {
        label: b.label,
        registrations: txInRange.filter((t) => t.type === "registration").length,
        joins: txInRange.filter((t) => t.type === "join").length,
        advances: advancesInRange,
      };
    });
  }, [rawTxs, rawBlocks, txPeriod]);

  const contribChartData = useMemo(() => {
    const buckets = getTimeBuckets(contribPeriod);
    return buckets.map((b) => {
      const inRange = rawTxs.filter((tx) => {
        const t = getTimestampSeconds(tx);
        return t >= b.start && t < b.end;
      });
      let amount = 0;
      for (const tx of inRange) {
        const raw = parseFloat(tx.amount);
        if (raw > 0) amount += raw / 1e6;
        else if (tx.type === "registration" || tx.type === "join") amount += levelsMap.get(1)?.contribution || 20;
        else if (tx.type === "advance") amount += levelsMap.get(1)?.advance || 20;
      }
      return { label: b.label, amount };
    });
  }, [rawTxs, contribPeriod, levelsMap]);

  // ── Commissions Chart Data (10% of contributions) ──────

  const commissionsChartData = useMemo(() => {
    const buckets = getTimeBuckets(commissionsPeriod);
    return buckets.map((b) => {
      const inRange = rawTxs.filter((tx) => {
        const t = getTimestampSeconds(tx);
        return t >= b.start && t < b.end;
      });
      let amount = 0;
      for (const tx of inRange) {
        const raw = parseFloat(tx.amount);
        if (raw > 0) amount += (raw / 1e6) * 0.1;
        else if (tx.type === "registration" || tx.type === "join") amount += (levelsMap.get(1)?.contribution || 20) * 0.1;
        else if (tx.type === "advance") amount += (levelsMap.get(1)?.advance || 20) * 0.1;
      }
      return { label: b.label, amount };
    });
  }, [rawTxs, commissionsPeriod, levelsMap]);

  // ── Votes by Level ─────────────────────────────────────

  const votesByLevel = useMemo<VotesByLevelData[]>(() => {
    const walletLevelMap = new Map<string, number>();
    for (const u of rawUsers) walletLevelMap.set(u.id.toLowerCase(), u.level);

    const levelVotesMap = new Map<number, { votes: number; users: number }>();
    for (const p of rawProfiles) {
      const votes = p.dao_votes || 0;
      const wallet = p.wallet_address?.toLowerCase() || "";
      const level = walletLevelMap.get(wallet) || 0;
      const key = level >= 1 && level <= 7 ? level : 0;
      const existing = levelVotesMap.get(key) || { votes: 0, users: 0 };
      existing.votes += votes;
      existing.users += 1;
      levelVotesMap.set(key, existing);
    }

    const data: VotesByLevelData[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = levelVotesMap.get(i);
      if (d && d.users > 0) data.push({ level: LEVEL_NAMES[i], levelId: i, votes: d.votes, users: d.users, color: LEVEL_COLORS[i] });
    }
    const noLevel = levelVotesMap.get(0);
    if (noLevel && noLevel.users > 0) data.push({ level: "Sin Nivel", levelId: 0, votes: noLevel.votes, users: noLevel.users, color: "#6b7280" });
    return data;
  }, [rawProfiles, rawUsers]);

  // ── Helpers ────────────────────────────────────────────

  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  const renderTrend = (trendList: TrendInfo[] | undefined) => {
    if (!trendList) return null;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {trendList.map((t) => (
          <span key={t.label} className={`inline-flex items-center gap-0.5 text-xs font-medium ${t.positive === true ? "text-green-400" : t.positive === false ? "text-red-400" : "text-muted-foreground"}`}>
            {t.positive === true && <ArrowUpRight className="w-3 h-3" />}
            {t.positive === false && <ArrowDownRight className="w-3 h-3" />}
            {t.positive === null && <Minus className="w-3 h-3" />}
            {t.value}
            <span className="text-muted-foreground ml-0.5">{t.label}</span>
          </span>
        ))}
      </div>
    );
  };

  const statCards = [
    { title: "Miembros Registrados", value: fmt(stats.totalMembers), subtitle: "Usuarios en plataforma", icon: Users, iconBg: "bg-purple-500/20", iconColor: "text-purple-400", trendKey: "members" },
    { title: "Bloques On-Chain", value: fmt(stats.totalBlocks), subtitle: `${fmt(stats.activeBlocks)} activos · ${fmt(stats.completedBlocks)} completados`, icon: Boxes, iconBg: "bg-blue-500/20", iconColor: "text-blue-400", trendKey: "blocks" },
    { title: "Avances de Nivel", value: fmt(stats.totalAdvances), subtitle: "Bloques completados (nivel up)", icon: TrendingUp, iconBg: "bg-orange-500/20", iconColor: "text-orange-400", trendKey: "advances" },
    { title: "Aportaciones Totales", value: `$${fmt(stats.totalContributions)}`, subtitle: `${fmt(stats.totalTransactions)} transacciones`, icon: DollarSign, iconBg: "bg-green-500/20", iconColor: "text-green-400", trendKey: "contributions" },
    { title: "Comisiones SocCoop", value: `$${fmt(stats.totalCommissions)}`, subtitle: "10% de aportaciones", icon: Landmark, iconBg: "bg-amber-500/20", iconColor: "text-amber-400", trendKey: "commissions" },
    { title: "Tasa de Activación", value: `${stats.activationRate}%`, subtitle: "Usuarios con actividad on-chain", icon: Percent, iconBg: "bg-pink-500/20", iconColor: "text-pink-400", trendKey: "activation" },
    { title: "Votos Emitidos", value: fmt(stats.totalVotes), subtitle: "En propuestas DAO", icon: Vote, iconBg: "bg-cyan-500/20", iconColor: "text-cyan-400", trendKey: "transactions" },
  ];

  const hasData = (arr: { [k: string]: number | string }[], ...keys: string[]) => arr.some((item) => keys.some((k) => typeof item[k] === "number" && (item[k] as number) > 0));

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-4 md:space-y-6 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Métricas</h1>
          <p className="text-xs md:text-sm text-muted-foreground truncate">Datos on-chain (The Graph)</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="shrink-0">
          <RefreshCw className={`w-4 h-4 mr-1 md:mr-2 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Actualizar</span>
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
        {statCards.map((stat, index) => (
          <Card key={index} className="p-3 md:p-4 bg-card/50 min-w-0">
            <div className="flex items-start justify-between">
              <div className={`p-2 md:p-3 rounded-lg ${stat.iconBg}`}>
                <stat.icon className={`w-4 h-4 md:w-5 md:h-5 ${stat.iconColor}`} />
              </div>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground mt-2 md:mt-4 truncate">{stat.title}</p>
            <p className="text-xl md:text-3xl font-bold text-foreground">{stat.value}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-1 truncate">{stat.subtitle}</p>
            <div className="mt-2 overflow-x-auto">{renderTrend(trends[stat.trendKey])}</div>
          </Card>
        ))}
      </div>

      {/* Chart: Registros de Usuarios + Transacciones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6 bg-card/50 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <h3 className="text-sm md:text-lg font-semibold text-foreground">Registros de Usuarios</h3>
            <PeriodSelector value={membersPeriod} onChange={setMembersPeriod} />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={membersChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
              <YAxis stroke="hsl(var(--muted-foreground))" allowDecimals={false} width={30} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [value, "Usuarios"]} />
              <Line type="monotone" dataKey="count" stroke="#06b6d4" strokeWidth={2} dot={{ fill: "#06b6d4", strokeWidth: 2, r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-3 md:p-6 bg-card/50 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <h3 className="text-sm md:text-lg font-semibold text-foreground">Transacciones On-Chain</h3>
            <PeriodSelector value={txPeriod} onChange={setTxPeriod} />
          </div>
          {hasData(txChartData, "registrations", "joins", "advances") ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={txChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" allowDecimals={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="registrations" name="Registros" fill="#8b5cf6" stackId="tx" />
                <Bar dataKey="joins" name="Uniones" fill="#06b6d4" stackId="tx" />
                <Bar dataKey="advances" name="Avances (Nivel)" fill="#22c55e" stackId="tx" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground space-y-3">
              <TrendingUp className="w-10 h-10 opacity-50" />
              <p className="text-center text-xs md:text-sm">Sin transacciones en este período.</p>
            </div>
          )}
        </Card>
      </div>

      {/* Chart: Aportaciones + Comisiones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6 bg-card/50 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <h3 className="text-sm md:text-lg font-semibold text-foreground">Aportaciones (USDT)</h3>
            <PeriodSelector value={contribPeriod} onChange={setContribPeriod} />
          </div>
          {hasData(contribChartData, "amount") ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={contribChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" width={35} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`$${fmt(value)} USDT`, "Aportaciones"]} />
                <Bar dataKey="amount" name="Aportaciones" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground space-y-3">
              <DollarSign className="w-10 h-10 opacity-50" />
              <p className="text-center text-xs md:text-sm">Sin aportaciones en este período.</p>
            </div>
          )}
        </Card>

        <Card className="p-3 md:p-6 bg-card/50 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <h3 className="text-sm md:text-lg font-semibold text-foreground">Comisiones SocCoop (USDT)</h3>
            <PeriodSelector value={commissionsPeriod} onChange={setCommissionsPeriod} />
          </div>
          {hasData(commissionsChartData, "amount") ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={commissionsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" width={35} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`$${fmt(value)} USDT`, "Comisiones"]} />
                <Bar dataKey="amount" name="Comisiones" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground space-y-3">
              <Landmark className="w-10 h-10 opacity-50" />
              <p className="text-center text-xs md:text-sm">Sin comisiones en este período.</p>
            </div>
          )}
        </Card>
      </div>

      {/* Chart: Votos DAO por Nivel */}
      <Card className="p-3 md:p-6 bg-card/50 min-w-0">
        <h3 className="text-sm md:text-lg font-semibold text-foreground mb-1">Votos DAO por Nivel</h3>
        <p className="text-xs md:text-sm text-muted-foreground mb-4">Distribución de votos según nivel on-chain</p>
        {votesByLevel.length > 0 && votesByLevel.some((d) => d.votes > 0) ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={votesByLevel} layout="vertical" margin={{ left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" stroke="hsl(var(--muted-foreground))" />
              <YAxis type="category" dataKey="level" stroke="hsl(var(--muted-foreground))" width={55} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, _name: string, props: { payload: VotesByLevelData }) => [
                  `${fmt(value)} votos (${props.payload.users} usuarios)`,
                  props.payload.level,
                ]}
              />
              <Bar dataKey="votes" name="Votos" radius={[0, 6, 6, 0]}>
                {votesByLevel.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground space-y-3">
            <Vote className="w-10 h-10 opacity-50" />
            <p className="text-center text-xs md:text-sm">No hay votos registrados aún.</p>
          </div>
        )}
      </Card>
    </div>
  );
};
