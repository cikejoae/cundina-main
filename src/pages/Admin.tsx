import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { DatabaseSection } from "@/components/admin/DatabaseSection";
import { MetricsSection } from "@/components/admin/MetricsSection";
import { MarketingSection } from "@/components/admin/MarketingSection";
import { SupportSection } from "@/components/admin/SupportSection";
import { DAOSection } from "@/components/admin/DAOSection";
import { ConfigSection } from "@/components/admin/ConfigSection";
import { SocCoopContributionsSection } from "@/components/admin/SocCoopContributionsSection";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";

const Admin = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminName, setAdminName] = useState("Admin Principal");
  const [allowedSections, setAllowedSections] = useState<string[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      checkAdminAccess();
    }
  }, [user, authLoading]);

  const checkAdminAccess = async () => {
    if (!user) {
      navigate("/auth");
      return;
    }

    try {
      const { data: rolesData, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (roleError || !rolesData || rolesData.length === 0) {
        toast({
          title: "Acceso denegado",
          description: "No tienes permisos de administrador",
          variant: "destructive",
        });
        navigate("/dashboard");
        return;
      }

      const userRoles = rolesData.map(r => r.role);

      const { data: permissionsData } = await supabase
        .from("admin_section_permissions")
        .select("section")
        .in("role", userRoles);

      const sections = permissionsData?.map(p => p.section) || [];
      
      if (sections.length === 0) {
        toast({
          title: "Acceso denegado",
          description: "No tienes permisos para ninguna sección",
          variant: "destructive",
        });
        navigate("/dashboard");
        return;
      }

      setAllowedSections(sections);
      setActiveSection("metrics");

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();

      if (profile) {
        setAdminName(profile.full_name || "Admin Principal");
      }

      setIsAdmin(true);
    } catch (error) {
      console.error("Error checking admin access:", error);
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const renderSection = () => {
    switch (activeSection) {
      case "database":
        return <DatabaseSection />;
      case "metrics":
        return <MetricsSection />;
      case "marketing":
        return <MarketingSection />;
      case "support":
        return <SupportSection />;
      case "dao":
        return <DAOSection />;
      case "config":
        return <ConfigSection />;
      case "soccoop_contributions":
        return <SocCoopContributionsSection />;
      default:
        return allowedSections.length > 0 ? renderSection() : null;
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const sidebarProps = {
    activeSection,
    onSectionChange: setActiveSection,
    onLogout: handleLogout,
    onGoToDashboard: () => navigate("/dashboard"),
    allowedSections,
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:block border-r border-border">
        <AdminSidebar {...sidebarProps} />
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <AdminSidebar {...sidebarProps} onClose={() => setMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader adminName={adminName} onMenuToggle={() => setMobileMenuOpen(true)} />
        <main className="flex-1 p-3 md:p-6 overflow-auto">
          {renderSection()}
        </main>
      </div>
    </div>
  );
};

export default Admin;
