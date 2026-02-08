import { Database, BarChart3, Megaphone, HeadphonesIcon, Vote, LogOut, Settings, Wallet, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

interface AdminSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  onLogout: () => void;
  onGoToDashboard: () => void;
  allowedSections?: string[];
  onClose?: () => void;
}

const menuItems = [
  { id: "metrics", label: "Métricas", icon: BarChart3 },
  { id: "marketing", label: "Marketing", icon: Megaphone },
  { id: "support", label: "Soporte", icon: HeadphonesIcon },
  { id: "dao", label: "DAO", icon: Vote },
  { id: "soccoop_contributions", label: "SocCoop", icon: Wallet },
  { id: "database", label: "Base de Datos", icon: Database },
  { id: "config", label: "Configuración", icon: Settings },
];

export const AdminSidebar = ({ activeSection, onSectionChange, onLogout, onGoToDashboard, allowedSections, onClose }: AdminSidebarProps) => {
  const filteredItems = allowedSections 
    ? menuItems.filter(item => allowedSections.includes(item.id))
    : menuItems;

  const handleSectionClick = (id: string) => {
    onSectionChange(id);
    onClose?.();
  };

  return (
    <div className="w-64 h-screen bg-card flex flex-col sticky top-0">
      <div className="h-16 px-6 border-b border-border flex items-center">
        <div className="flex items-center gap-3">
          <img src={logo} alt="CundinaBlock" className="w-10 h-10 rounded-full object-cover" />
          <div>
            <h2 className="font-semibold text-foreground">CundinaBlock</h2>
            <p className="text-xs text-muted-foreground">Admin Dashboard</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {filteredItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleSectionClick(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
              activeSection === item.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-border space-y-2">
        <button
          onClick={() => { onGoToDashboard(); onClose?.(); }}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LayoutDashboard className="w-5 h-5" />
          Dashboard
        </button>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Cerrar Sesión
        </button>
      </div>
    </div>
  );
};
