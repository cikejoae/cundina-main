import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { config } from "@/config/wagmi";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthLinkRouter } from "@/components/AuthLinkRouter";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Connect from "./pages/Connect";
import Dashboard from "./pages/Dashboard";
import Levels from "./pages/Levels";
import MyBlocks from "./pages/MyBlocks";
import Ranking from "./pages/Ranking";
import BlockManager from "./pages/BlockManager";
import Profile from "./pages/Profile";
import DeployContracts from "./pages/DeployContracts";
import BlockDetail from "./pages/BlockDetail";
import InviteMembers from "./pages/InviteMembers";
import RegisterForm from "./pages/RegisterForm";
import ManageWallets from "./pages/ManageWallets";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthLinkRouter />
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/connect" element={<Connect />} />
              <Route path="/register-form" element={<RegisterForm />} />
              <Route path="/register" element={<RegisterForm />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/levels" element={<Levels />} />
              <Route path="/my-blocks" element={<MyBlocks />} />
              <Route path="/blocks" element={<BlockManager />} />
              <Route path="/wallets" element={<ManageWallets />} />
              <Route path="/block/:blockId" element={<BlockDetail />} />
              <Route path="/invite/:blockAddress?" element={<InviteMembers />} />
              <Route path="/ranking" element={<Ranking />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/deploy" element={<DeployContracts />} />
              <Route path="/admin" element={<Admin />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </WagmiProvider>
);

export default App;
