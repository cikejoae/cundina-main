import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
  Wallet, 
  Shield, 
  Save, 
  Plus, 
  Trash2, 
  Users,
  Database,
  BarChart3,
  Megaphone,
  HeadphonesIcon,
  Vote,
  Settings,
  Check,
  X
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface PlatformWallet {
  id: string;
  position: number;
  wallet_address: string;
  is_active: boolean;
  name: string | null;
}

interface AdminPermission {
  id: string;
  role: string;
  section: string;
}

interface UserWithRole {
  id: string;
  full_name: string;
  email: string;
  roles: string[];
}

const SECTIONS = [
  { id: "database", label: "Base de Datos", icon: Database },
  { id: "metrics", label: "Métricas", icon: BarChart3 },
  { id: "marketing", label: "Marketing", icon: Megaphone },
  { id: "support", label: "Soporte", icon: HeadphonesIcon },
  { id: "dao", label: "DAO", icon: Vote },
  { id: "config", label: "Configuración", icon: Settings },
];

const ROLES = [
  { id: "admin", label: "Administrador General", description: "Acceso completo a todas las secciones" },
  { id: "support", label: "Soporte Técnico", description: "Acceso a la sección de Soporte" },
  { id: "marketing", label: "Community Manager", description: "Acceso a la sección de Marketing" },
  { id: "dao_manager", label: "Sociedad Cooperativa", description: "Acceso a la sección de DAO" },
];

interface AdminWallet {
  key: string;
  label: string;
  description: string;
  address: string;
}

export const ConfigSection = () => {
  const [wallets, setWallets] = useState<PlatformWallet[]>([]);
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAdminWallets, setSavingAdminWallets] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(1);
  const [adminWallets, setAdminWallets] = useState<AdminWallet[]>([
    { key: "wallet_sociedad_cooperativa", label: "Billetera Sociedad Cooperativa", description: "Recibe el 10% de comisión de la plataforma", address: "" },
    { key: "wallet_propiedad_intelectual", label: "Billetera Propiedad Intelectual", description: "Billetera de la empresa de propiedad intelectual", address: "" },
  ]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch platform wallets
      const { data: walletsData } = await supabase
        .from("platform_wallets")
        .select("*")
        .order("position");
      
      // Fetch current rotation position
      const { data: configData } = await supabase
        .from("platform_config")
        .select("value")
        .eq("key", "current_wallet_position")
        .single();

      // Fetch admin wallets from platform_config
      const { data: adminWalletsData } = await supabase
        .from("platform_config")
        .select("key, value")
        .in("key", ["wallet_sociedad_cooperativa", "wallet_propiedad_intelectual"]);

      // Fetch permissions
      const { data: permissionsData } = await supabase
        .from("admin_section_permissions")
        .select("*");

      // Fetch users with admin roles
      const { data: rolesData } = await supabase
        .from("user_roles")
        .select("user_id, role");

      if (rolesData && rolesData.length > 0) {
        const userIds = [...new Set(rolesData.map(r => r.user_id))];
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);

        if (profilesData) {
          const usersWithRoles = profilesData.map(profile => ({
            id: profile.id,
            full_name: profile.full_name,
            email: profile.email,
            roles: rolesData
              .filter(r => r.user_id === profile.id)
              .map(r => r.role)
          }));
          setUsers(usersWithRoles);
        }
      }

      setWallets(walletsData || []);
      setPermissions(permissionsData || []);
      if (configData) {
        setCurrentPosition(parseInt(configData.value));
      }
      
      // Set admin wallets from config
      if (adminWalletsData) {
        setAdminWallets(prev => prev.map(w => {
          const found = adminWalletsData.find(d => d.key === w.key);
          return found ? { ...w, address: found.value } : w;
        }));
      }
    } catch (error) {
      console.error("Error fetching config data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleWalletChange = (position: number, field: keyof PlatformWallet, value: string | boolean | null) => {
    setWallets(prev => {
      const existing = prev.find(w => w.position === position);
      if (existing) {
        return prev.map(w => w.position === position ? { ...w, [field]: value } : w);
      } else {
        return [...prev, { 
          id: `new-${position}`, 
          position, 
          wallet_address: field === "wallet_address" ? value as string : "", 
          is_active: field === "is_active" ? value as boolean : true,
          name: field === "name" ? value as string : null
        }];
      }
    });
  };

  const saveWallets = async () => {
    setSaving(true);
    try {
      for (const wallet of wallets) {
        if (!wallet.wallet_address) continue;
        
        if (wallet.id.startsWith("new-")) {
          await supabase.from("platform_wallets").insert({
            position: wallet.position,
            wallet_address: wallet.wallet_address,
            is_active: wallet.is_active,
            name: wallet.name
          });
        } else {
          await supabase.from("platform_wallets")
            .update({
              wallet_address: wallet.wallet_address,
              is_active: wallet.is_active,
              name: wallet.name
            })
            .eq("id", wallet.id);
        }
      }
      
      toast({
        title: "Configuración guardada",
        description: "Las billeteras de plataforma han sido actualizadas",
      });
      
      fetchData();
    } catch (error) {
      console.error("Error saving wallets:", error);
      toast({
        title: "Error",
        description: "No se pudo guardar la configuración",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAdminWalletChange = (key: string, value: string) => {
    setAdminWallets(prev => prev.map(w => w.key === key ? { ...w, address: value } : w));
  };

  const saveAdminWallets = async () => {
    setSavingAdminWallets(true);
    try {
      for (const wallet of adminWallets) {
        // Check if config exists
        const { data: existing } = await supabase
          .from("platform_config")
          .select("id")
          .eq("key", wallet.key)
          .single();

        if (existing) {
          await supabase.from("platform_config")
            .update({ value: wallet.address })
            .eq("key", wallet.key);
        } else {
          await supabase.from("platform_config").insert({
            key: wallet.key,
            value: wallet.address
          });
        }
      }
      
      toast({
        title: "Configuración guardada",
        description: "Las billeteras de administración han sido actualizadas",
      });
      
      fetchData();
    } catch (error) {
      console.error("Error saving admin wallets:", error);
      toast({
        title: "Error",
        description: "No se pudo guardar la configuración",
        variant: "destructive",
      });
    } finally {
      setSavingAdminWallets(false);
    }
  };

  const deleteWallet = async (id: string) => {
    if (id.startsWith("new-")) {
      setWallets(prev => prev.filter(w => w.id !== id));
      return;
    }

    try {
      await supabase.from("platform_wallets").delete().eq("id", id);
      toast({
        title: "Billetera eliminada",
        description: "La billetera ha sido removida de la rotación",
      });
      fetchData();
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo eliminar la billetera",
        variant: "destructive",
      });
    }
  };

  const assignRole = async (userId: string, role: string) => {
    try {
      // Check if role already exists
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .eq("role", role as "admin" | "user")
        .single();

      if (existingRole) {
        // Remove role
        await supabase.from("user_roles").delete().eq("id", existingRole.id);
        toast({
          title: "Rol removido",
          description: `El rol ha sido removido del usuario`,
        });
      } else {
        // Add role - use raw insert to bypass type restrictions for new roles
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role: role as "admin" | "user" });
        
        if (error) throw error;
        
        toast({
          title: "Rol asignado",
          description: `El rol ha sido asignado al usuario`,
        });
      }
      
      fetchData();
    } catch (error) {
      console.error("Error managing role:", error);
      toast({
        title: "Error",
        description: "No se pudo gestionar el rol",
        variant: "destructive",
      });
    }
  };

  const hasPermission = (role: string, section: string) => {
    return permissions.some(p => p.role === role && p.section === section);
  };

  const togglePermission = async (role: string, section: string) => {
    try {
      const existing = permissions.find(p => p.role === role && p.section === section);
      
      if (existing) {
        await supabase.from("admin_section_permissions").delete().eq("id", existing.id);
      } else {
        await supabase.from("admin_section_permissions").insert({ role, section });
      }
      
      fetchData();
      toast({
        title: "Permiso actualizado",
        description: "Los permisos han sido actualizados",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo actualizar el permiso",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuración</h1>
        <p className="text-muted-foreground">
          Gestiona las billeteras de plataforma y permisos de administración
        </p>
      </div>

      <Tabs defaultValue="wallets" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="wallets" className="flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            Billeteras de Plataforma
          </TabsTrigger>
          <TabsTrigger value="permissions" className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Permisos de Admin
          </TabsTrigger>
        </TabsList>

        <TabsContent value="wallets" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-primary" />
                Billeteras de Rotación
              </CardTitle>
              <CardDescription>
                Define las 10 billeteras que recibirán usuarios sin código de referido.
                La rotación actual está en la posición <Badge variant="secondary">{currentPosition}</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((position) => {
                  const wallet = wallets.find(w => w.position === position);
                  return (
                    <div 
                      key={position} 
                      className={`flex items-center gap-4 p-4 rounded-lg border ${
                        currentPosition === position ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        currentPosition === position 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {position}
                      </div>
                      
                      <div className="w-40">
                        <Input
                          placeholder="Nombre (ej: Admin 1)"
                          value={wallet?.name || ""}
                          onChange={(e) => handleWalletChange(position, "name", e.target.value || null)}
                          className="text-sm"
                        />
                      </div>

                      <div className="flex-1">
                        <Input
                          placeholder="0x..."
                          value={wallet?.wallet_address || ""}
                          onChange={(e) => handleWalletChange(position, "wallet_address", e.target.value)}
                          className="font-mono text-sm"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Label htmlFor={`active-${position}`} className="text-sm text-muted-foreground">
                          Activa
                        </Label>
                        <Switch
                          id={`active-${position}`}
                          checked={wallet?.is_active ?? true}
                          onCheckedChange={(checked) => handleWalletChange(position, "is_active", checked)}
                        />
                      </div>

                      {wallet && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteWallet(wallet.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <Button onClick={saveWallets} disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? "Guardando..." : "Guardar Configuración"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Billeteras de Administración
              </CardTitle>
              <CardDescription>
                Define las billeteras que reciben comisiones y pertenecen a la estructura administrativa
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                {adminWallets.map((wallet) => (
                  <div 
                    key={wallet.key} 
                    className="flex items-center gap-4 p-4 rounded-lg border border-border"
                  >
                    <div className="min-w-[200px]">
                      <p className="font-medium text-sm">{wallet.label}</p>
                      <p className="text-xs text-muted-foreground">{wallet.description}</p>
                    </div>
                    
                    <div className="flex-1">
                      <Input
                        placeholder="0x..."
                        value={wallet.address}
                        onChange={(e) => handleAdminWalletChange(wallet.key, e.target.value)}
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button onClick={saveAdminWallets} disabled={savingAdminWallets}>
                  <Save className="w-4 h-4 mr-2" />
                  {savingAdminWallets ? "Guardando..." : "Guardar Billeteras Admin"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>¿Cómo funciona la rotación?</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>• Cuando un usuario se registra SIN código de referido, se le asigna la billetera actual en rotación.</p>
              <p>• Después de cada asignación, la posición avanza al siguiente número (1→2→3→...→10→1).</p>
              <p>• Las billeteras inactivas se saltan en la rotación.</p>
              <p>• Esto asegura distribución equitativa entre las 10 billeteras de la plataforma.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Matriz de Permisos
              </CardTitle>
              <CardDescription>
                Define qué secciones puede ver cada rol de administración
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-3 font-medium">Rol</th>
                      {SECTIONS.map(section => (
                        <th key={section.id} className="p-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <section.icon className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-medium">{section.label}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROLES.map(role => (
                      <tr key={role.id} className="border-b">
                        <td className="p-3">
                          <div>
                            <p className="font-medium">{role.label}</p>
                            <p className="text-xs text-muted-foreground">{role.description}</p>
                          </div>
                        </td>
                        {SECTIONS.map(section => (
                          <td key={section.id} className="p-3 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => togglePermission(role.id, section.id)}
                              className={hasPermission(role.id, section.id) 
                                ? "text-green-500 hover:text-green-600" 
                                : "text-muted-foreground hover:text-foreground"
                              }
                              disabled={role.id === "admin"} // Admin siempre tiene todos los permisos
                            >
                              {hasPermission(role.id, section.id) ? (
                                <Check className="w-5 h-5" />
                              ) : (
                                <X className="w-5 h-5" />
                              )}
                            </Button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Usuarios con Roles de Administración
              </CardTitle>
              <CardDescription>
                Gestiona los roles asignados a cada usuario
              </CardDescription>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No hay usuarios con roles de administración</p>
                  <p className="text-sm">Asigna roles desde la sección de Base de Datos</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {users.map(user => (
                    <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <p className="font-medium">{user.full_name}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                      <div className="flex gap-2">
                        {user.roles.map(role => (
                          <Badge key={role} variant="secondary">
                            {ROLES.find(r => r.id === role)?.label || role}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
