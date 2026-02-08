import { Link, useLocation, useNavigate } from "react-router-dom";
import { Home, Grid3x3, Trophy, User, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NotificationBell } from "./NotificationBell";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import logo from "@/assets/logo.png";
import { useAppKitAccount } from "@reown/appkit/react";
import { ReownManageWalletButton, ReownAddFundsButton } from "./ReownWalletActions";

export const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isConnected } = useAppKitAccount();
  const [isAdmin, setIsAdmin] = useState(false);
  
  useEffect(() => {
    const checkAdminRole = async () => {
      if (!user) {
        setIsAdmin(false);
        return;
      }
      
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();
      
      setIsAdmin(!!data);
    };
    
    checkAdminRole();
  }, [user]);
  
  const isActive = (path: string) => location.pathname === path;
  
  const navItems = [
    { path: "/dashboard", icon: Home, label: "Inicio" },
    { path: "/my-blocks", icon: Grid3x3, label: "Mis bloques" },
    { path: "/ranking", icon: Trophy, label: "Ranking" },
    { path: "/profile", icon: User, label: "Perfil" },
  ];

  return (
    <>
      {/* Top Header */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-header text-header-foreground border-b border-border/20">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link to="/dashboard" className="flex items-center gap-3">
              <img src={logo} alt="CundinaBlock" className="w-8 h-8 md:w-10 md:h-10" />
              <span className="text-lg md:text-xl font-bold">Cundina Block</span>
            </Link>
            
            <div className="flex items-center gap-2">
              {/* Wallet Actions - Only show when connected */}
              {isConnected && (
                <>
                  <div className="hidden sm:flex items-center gap-2">
                    <ReownManageWalletButton 
                      variant="ghost" 
                      size="sm"
                      className="h-8 text-xs"
                    />
                    <ReownAddFundsButton 
                      variant="outline" 
                      size="sm"
                      className="h-8 text-xs bg-transparent"
                      label="Fondos"
                    />
                  </div>
                  {/* Mobile: Show compact buttons */}
                  <div className="flex sm:hidden items-center gap-1">
                    <ReownManageWalletButton 
                      variant="ghost" 
                      size="sm"
                      className="h-8 px-2"
                      showIcon={true}
                      label=""
                    />
                    <ReownAddFundsButton 
                      variant="ghost" 
                      size="sm"
                      className="h-8 px-2"
                      showIcon={true}
                      label=""
                    />
                  </div>
                </>
              )}
              
              {isAdmin && (
                <button
                  onClick={() => navigate('/admin')}
                  className="p-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                  title="Panel de Administración"
                >
                  <Shield className="w-5 h-5" />
                </button>
              )}
              <NotificationBell />
            </div>
          </div>
        </div>
      </nav>

      {/* Bottom Navigation - Mobile & Desktop */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-header text-header-foreground border-t border-border/20 pb-safe">
        <div className="container mx-auto px-2 md:px-4">
          <div className="flex items-center justify-around h-16 md:h-20">
            {navItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center justify-center gap-1 py-2 px-3 md:px-4 rounded-lg transition-all ${
                  isActive(item.path)
                    ? "text-primary"
                    : "text-muted-foreground hover:text-header-foreground"
                }`}
              >
                <item.icon className="w-5 h-5 md:w-6 md:h-6" />
                <span className="text-xs md:text-sm font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
    </>
  );
};
