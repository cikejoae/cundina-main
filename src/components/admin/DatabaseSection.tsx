import { useState, useEffect } from "react";
import { Search, Download, Eye, Mail, Shield, ShieldOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { querySubgraph } from "@/lib/subgraph";

interface UserRecord {
  id: string;
  wallet_address: string;
  full_name: string;
  email: string;
  phone: string;
  level: number;
  levelName: string;
  status: string;
  isAdmin: boolean;
}

const levelNames: Record<number, string> = {
  1: "Curioso",
  2: "Soñador",
  3: "Novato",
  4: "Aprendiz",
  5: "Asesor",
  6: "Maestro",
  7: "Leyenda",
};

// Subgraph query to get on-chain user levels
const USERS_LEVEL_QUERY = `
  query GetUsersLevels($addresses: [String!]!) {
    users(where: { id_in: $addresses }, first: 1000) {
      id
      level
      blocks {
        id
        status
      }
    }
  }
`;

interface SubgraphUserLevel {
  id: string;
  level: number;
  blocks: { id: string; status: number }[];
}

export const DatabaseSection = () => {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [updatingRole, setUpdatingRole] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      // 1. Get all profiles from Supabase (metadata only)
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, wallet_address");

      if (error) throw error;

      // 2. Get all admin roles at once
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");

      const adminUserIds = new Set(adminRoles?.map(r => r.user_id) || []);

      // 3. Get wallet addresses for all users
      const userIds = (profiles || []).map(p => p.id);
      const { data: allWallets } = await supabase
        .from("user_wallets")
        .select("user_id, wallet_address")
        .in("user_id", userIds);

      const walletMap = new Map<string, string>();
      allWallets?.forEach(w => {
        if (!walletMap.has(w.user_id)) {
          walletMap.set(w.user_id, w.wallet_address);
        }
      });

      // 4. Query Subgraph for on-chain levels using wallet addresses
      const walletAddresses = Array.from(walletMap.values())
        .filter(Boolean)
        .map(a => a.toLowerCase());

      let onChainLevels = new Map<string, { level: number; hasActiveBlock: boolean }>();

      if (walletAddresses.length > 0) {
        try {
          const result = await querySubgraph<{ users: SubgraphUserLevel[] }>(
            USERS_LEVEL_QUERY,
            { addresses: walletAddresses }
          );
          result.users?.forEach(u => {
            const hasActive = u.blocks?.some(b => b.status === 0) || false;
            onChainLevels.set(u.id.toLowerCase(), {
              level: u.level,
              hasActiveBlock: hasActive,
            });
          });
        } catch (subgraphError) {
          console.warn("Subgraph unavailable, showing level 1 for all:", subgraphError);
        }
      }

      // 5. Build user records
      const usersWithDetails = (profiles || []).map((profile) => {
        const walletAddr = walletMap.get(profile.id) || profile.wallet_address || "";
        const onChain = onChainLevels.get(walletAddr.toLowerCase());
        const currentLevel = onChain?.level || 1;

        let status: string;
        if (!walletAddr) {
          status = "Sin Wallet";
        } else if (onChain?.hasActiveBlock) {
          status = "Activo";
        } else if (currentLevel > 1) {
          status = "Completado";
        } else {
          status = "Registrado";
        }

        return {
          id: profile.id,
          wallet_address: walletAddr,
          full_name: profile.full_name,
          email: profile.email,
          phone: profile.phone,
          level: currentLevel,
          levelName: levelNames[currentLevel] || "Curioso",
          status,
          isAdmin: adminUserIds.has(profile.id),
        };
      });

      setUsers(usersWithDetails);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAdminRole = async (user: UserRecord) => {
    setUpdatingRole(true);
    try {
      if (user.isAdmin) {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", user.id)
          .eq("role", "admin");
        if (error) throw error;
        toast({
          title: "Rol actualizado",
          description: `Se removió el rol de administrador de ${user.full_name}`,
        });
      } else {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: user.id, role: "admin" });
        if (error) throw error;
        toast({
          title: "Rol actualizado",
          description: `${user.full_name} ahora es administrador`,
        });
      }
      await fetchUsers();
      setRoleDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error("Error updating role:", error);
      toast({
        title: "Error",
        description: "No se pudo actualizar el rol",
        variant: "destructive",
      });
    } finally {
      setUpdatingRole(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.wallet_address.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLevel = levelFilter === "all" || user.level.toString() === levelFilter;
    const matchesStatus = statusFilter === "all" || user.status === statusFilter;
    return matchesSearch && matchesLevel && matchesStatus;
  });

  const exportToCSV = () => {
    const headers = ["ID", "Billetera", "Nombre", "Email", "Teléfono", "Nivel", "Estado", "Es Admin"];
    const csvContent = [
      headers.join(","),
      ...filteredUsers.map(user => [
        user.id,
        user.wallet_address || "",
        `"${user.full_name.replace(/"/g, '""')}"`,
        user.email,
        user.phone,
        `${user.level} - ${user.levelName}`,
        user.status,
        user.isAdmin ? "Sí" : "No",
      ].join(","))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `usuarios_cundinablock_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Exportación exitosa",
      description: `Se exportaron ${filteredUsers.length} registros`,
    });
  };

  const stats = {
    total: users.length,
    active: users.filter(u => u.status === "Activo").length,
    completed: users.filter(u => u.status === "Completado").length,
    registered: users.filter(u => u.status === "Registrado").length,
  };

  const truncateWallet = (address: string) => {
    if (!address) return "-";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getLevelColor = (level: number) => {
    const colors: Record<number, string> = {
      1: "bg-cyan-500/20 text-cyan-400",
      2: "bg-blue-500/20 text-blue-400",
      3: "bg-green-500/20 text-green-400",
      4: "bg-yellow-500/20 text-yellow-400",
      5: "bg-orange-500/20 text-orange-400",
      6: "bg-purple-500/20 text-purple-400",
      7: "bg-pink-500/20 text-pink-400",
    };
    return colors[level] || colors[1];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Activo": return "bg-green-500/20 text-green-400";
      case "Completado": return "bg-blue-500/20 text-blue-400";
      case "Registrado": return "bg-yellow-500/20 text-yellow-400";
      case "Sin Wallet": return "bg-red-500/20 text-red-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <Card className="p-4 bg-card/50">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, billetera o correo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-background"
            />
          </div>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Todos los niveles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los niveles</SelectItem>
              {Object.entries(levelNames).map(([id, name]) => (
                <SelectItem key={id} value={id}>Nivel {id} - {name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="Activo">Activo</SelectItem>
              <SelectItem value="Completado">Completado</SelectItem>
              <SelectItem value="Registrado">Registrado</SelectItem>
              <SelectItem value="Sin Wallet">Sin Wallet</SelectItem>
            </SelectContent>
          </Select>
          <Button className="gap-2" onClick={exportToCSV}>
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Total Registros</p>
          <p className="text-3xl font-bold text-foreground">{stats.total}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Activos</p>
          <p className="text-3xl font-bold text-green-400">{stats.active}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Completados</p>
          <p className="text-3xl font-bold text-blue-400">{stats.completed}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Solo Registrados</p>
          <p className="text-3xl font-bold text-yellow-400">{stats.registered}</p>
        </Card>
      </div>

      {/* Table */}
      <Card className="bg-card/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Billetera</TableHead>
              <TableHead className="text-muted-foreground">Nombre</TableHead>
              <TableHead className="text-muted-foreground">Correo</TableHead>
              <TableHead className="text-muted-foreground">Teléfono</TableHead>
              <TableHead className="text-muted-foreground">Nivel</TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
              <TableHead className="text-muted-foreground">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No se encontraron registros
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id} className="border-border">
                  <TableCell className="font-mono text-sm">{truncateWallet(user.wallet_address)}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {user.full_name}
                      {user.isAdmin && <Badge className="bg-primary/20 text-primary text-xs">Admin</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell className="text-muted-foreground">{user.phone}</TableCell>
                  <TableCell>
                    <Badge className={getLevelColor(user.level)}>
                      Nivel {user.level} - {user.levelName}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(user.status)}>{user.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Mail className="w-4 h-4" />
                      </Button>
                      <Dialog open={roleDialogOpen && selectedUser?.id === user.id} onOpenChange={(open) => {
                        setRoleDialogOpen(open);
                        if (!open) setSelectedUser(null);
                      }}>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 ${user.isAdmin ? 'text-primary' : 'text-muted-foreground'}`}
                            onClick={() => setSelectedUser(user)}
                          >
                            {user.isAdmin ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Gestionar Rol de Administrador</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <p className="text-sm text-muted-foreground">Usuario: <span className="text-foreground font-medium">{user.full_name}</span></p>
                              <p className="text-sm text-muted-foreground">Email: <span className="text-foreground">{user.email}</span></p>
                              <p className="text-sm text-muted-foreground">Estado actual: {user.isAdmin ? (
                                <Badge className="bg-primary/20 text-primary ml-2">Administrador</Badge>
                              ) : (
                                <Badge className="bg-muted text-muted-foreground ml-2">Usuario</Badge>
                              )}</p>
                            </div>
                            <Button
                              onClick={() => toggleAdminRole(user)}
                              disabled={updatingRole}
                              className="w-full"
                              variant={user.isAdmin ? "destructive" : "default"}
                            >
                              {updatingRole ? "Actualizando..." : user.isAdmin ? "Remover Admin" : "Hacer Admin"}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
