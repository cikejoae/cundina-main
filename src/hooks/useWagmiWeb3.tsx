import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { useCallback } from 'react';
import { toast } from 'sonner';

export const useWagmiWeb3 = () => {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const connectWallet = useCallback(async () => {
    try {
      const reownConnector = connectors.find((c) => c.name.includes('Reown') || c.name.includes('WalletConnect'));
      
      if (reownConnector) {
        connect({ connector: reownConnector });
      } else if (connectors[0]) {
        connect({ connector: connectors[0] });
      }
    } catch (error: any) {
      toast.error('Error al conectar wallet: ' + error.message);
    }
  }, [connect, connectors]);

  const switchToSepolia = useCallback(async () => {
    try {
      if (switchChain) {
        switchChain({ chainId: 11155111 });
      }
    } catch (error: any) {
      toast.error('Error al cambiar red: ' + error.message);
    }
  }, [switchChain]);

  const disconnectWallet = useCallback(() => {
    disconnect();
  }, [disconnect]);

  return {
    address,
    isConnected,
    chain,
    connectWallet,
    disconnectWallet,
    switchToSepolia,
  };
};
