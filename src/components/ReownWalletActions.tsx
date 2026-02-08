import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { Loader2, Wallet, RefreshCw, Unplug, Link2, Settings, PlusCircle } from "lucide-react";

interface ReownWalletActionsProps {
  showSwitchAccount?: boolean;
  onDisconnect?: () => void;
  size?: "sm" | "default" | "lg";
}

export const ReownWalletActions = ({ 
  showSwitchAccount = true, 
  onDisconnect,
  size = "default" 
}: ReownWalletActionsProps) => {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { disconnect, isPending } = useDisconnect();

  const handleOpenModal = () => {
    open?.();
  };

  const handleDisconnect = () => {
    disconnect();
    onDisconnect?.();
  };

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        {showSwitchAccount && (
          <Button 
            variant="ghost" 
            size={size === "sm" ? "sm" : "default"} 
            onClick={handleOpenModal}
            className="h-8"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            <span className="text-xs">Cambiar Wallet</span>
          </Button>
        )}
      </div>
    );
  }

  return (
    <Button
      onClick={handleOpenModal}
      disabled={isPending}
      size={size}
      className="bg-primary hover:bg-primary/90 text-primary-foreground"
    >
      {isPending ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <Wallet className="w-4 h-4 mr-2" />
      )}
      Conectar Wallet
    </Button>
  );
};

// Standalone connect button
export const ReownConnectButton = ({ 
  className = "",
  disabled = false,
  fullWidth = true,
}: { 
  className?: string; 
  disabled?: boolean;
  fullWidth?: boolean;
}) => {
  const { open } = useAppKit();
  const { isConnected } = useAppKitAccount();

  const handleOpenModal = () => {
    open?.();
  };

  return (
    <Button
      onClick={handleOpenModal}
      disabled={disabled}
      className={`${fullWidth ? 'w-full' : ''} bg-primary hover:bg-primary/90 text-primary-foreground ${className}`}
    >
      <Link2 className="w-4 h-4 mr-1" />
      {isConnected ? "Cambiar Wallet" : "Conectar Wallet"}
    </Button>
  );
};

// Manage Wallet button - Opens Reown modal
export const ReownManageWalletButton = ({
  variant = "outline",
  size = "sm",
  className = "",
  showIcon = true,
  label = "Administrar Billetera",
}: {
  variant?: "outline" | "default" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
  className?: string;
  showIcon?: boolean;
  label?: string;
}) => {
  const { open } = useAppKit();

  const handleOpenModal = () => {
    open?.();
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleOpenModal}
      className={`${className}`}
    >
      {showIcon && <Settings className="w-4 h-4 mr-1" />}
      {label}
    </Button>
  );
};

// Add Funds button - Opens Reown onramp modal
export const ReownAddFundsButton = ({
  variant = "default",
  size = "default",
  className = "",
  showIcon = true,
  label = "Agregar Fondos",
  fullWidth = false,
}: {
  variant?: "outline" | "default" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
  className?: string;
  showIcon?: boolean;
  label?: string;
  fullWidth?: boolean;
}) => {
  const { open } = useAppKit();

  const handleOpenOnramp = () => {
    // Open Reown modal with onramp view if available
    open?.({ view: 'OnRampProviders' });
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleOpenOnramp}
      className={`${fullWidth ? 'w-full' : ''} ${
        variant === 'default' 
          ? 'bg-primary hover:bg-primary/90 text-primary-foreground' 
          : ''
      } ${className}`}
    >
      {showIcon && <PlusCircle className="w-4 h-4 mr-1" />}
      {label}
    </Button>
  );
};

// Disconnect button
export const ReownDisconnectButton = ({
  onDisconnect,
  variant = "outline",
  size = "sm",
  className = "",
}: {
  onDisconnect?: () => void;
  variant?: "outline" | "default" | "destructive" | "ghost";
  size?: "sm" | "default" | "lg";
  className?: string;
}) => {
  const { disconnect, isPending } = useDisconnect();

  const handleDisconnect = () => {
    disconnect();
    onDisconnect?.();
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleDisconnect}
      disabled={isPending}
      className={`text-destructive hover:text-destructive border-destructive/50 ${className}`}
    >
      {isPending ? (
        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
      ) : (
        <Unplug className="w-4 h-4 mr-1" />
      )}
      Desconectar
    </Button>
  );
};

export default ReownWalletActions;
