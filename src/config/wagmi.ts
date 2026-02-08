import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { mainnet, sepolia } from '@reown/appkit/networks';

// Reown Project ID - this is a publishable key, safe to include in code
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || 'a8ff4c9a60eaf0a42e83b68415cf0fa3';

if (!projectId) {
  console.warn('VITE_REOWN_PROJECT_ID is not set');
}

// Set up the Wagmi Adapter
export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [mainnet, sepolia],
});

// Set up metadata for the app
const metadata = {
  name: 'CundinaBlock',
  description: 'Plataforma de ahorro colaborativo DeFi',
  url: window.location.origin,
  icons: [`${window.location.origin}/favicon.png`],
};

// Create the modal
createAppKit({
  adapters: [wagmiAdapter],
  networks: [mainnet, sepolia],
  defaultNetwork: sepolia,
  projectId,
  metadata,
  features: {
    analytics: true,
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#6366f1',
    '--w3m-border-radius-master': '8px',
  },
});

export const config = wagmiAdapter.wagmiConfig;
export const REOWN_PROJECT_ID = projectId;
