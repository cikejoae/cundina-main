import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, HelpCircle, X } from "lucide-react";

interface WalletTutorialModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const wallets = [
  {
    name: "MetaMask",
    icon: "🦊",
    url: "https://metamask.io/download/",
    recommended: true,
  },
  {
    name: "Trust Wallet",
    icon: "🛡️",
    url: "https://trustwallet.com/download",
    recommended: false,
  },
  {
    name: "Coinbase Wallet",
    icon: "🔵",
    url: "https://www.coinbase.com/wallet/downloads",
    recommended: false,
  },
];

const WalletTutorialModal = ({ open, onOpenChange }: WalletTutorialModalProps) => {
  const [selectedWallet, setSelectedWallet] = useState<string>("MetaMask");

  const addSepoliaNetwork = async () => {
    if (typeof window.ethereum !== "undefined") {
      try {
        const eth = window.ethereum as any;
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0xaa36a7",
              chainName: "Sepolia Testnet",
              nativeCurrency: {
                name: "Sepolia ETH",
                symbol: "ETH",
                decimals: 18,
              },
              rpcUrls: ["https://rpc.sepolia.org"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
      } catch (error) {
        console.error("Error adding Sepolia network:", error);
      }
    } else {
      window.open("https://metamask.io/download/", "_blank");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-gradient-to-b from-primary/20 to-background border-primary/30">
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none"
        >
          <X className="h-5 w-5 text-foreground" />
          <span className="sr-only">Cerrar</span>
        </button>

        <DialogHeader className="text-center space-y-3">
          <DialogTitle className="text-2xl font-bold text-center">
            Primeros Pasos: Instala una Billetera
          </DialogTitle>
          <p className="text-muted-foreground text-sm">
            Para interactuar con Cundina Block necesitas una billetera compatible con Ethereum. Soportamos:
          </p>
        </DialogHeader>

        {/* Wallet Options */}
        <div className="flex justify-center gap-4 py-4">
          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              onClick={() => setSelectedWallet(wallet.name)}
              className={`flex flex-col items-center gap-2 p-3 rounded-lg transition-all ${
                selectedWallet === wallet.name
                  ? "bg-primary/30 ring-2 ring-primary"
                  : "hover:bg-primary/10"
              }`}
            >
              <span className="text-3xl">{wallet.icon}</span>
              <span className={`text-sm font-medium ${
                selectedWallet === wallet.name ? "text-primary" : "text-foreground"
              }`}>
                {wallet.name}
              </span>
              {wallet.recommended && (
                <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                  Recomendado
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-border my-2" />

        {/* Add Network Section */}
        <div className="text-center space-y-3">
          <h3 className="font-semibold text-foreground">Añadir Red Sepolia (Ethereum Testnet)</h3>
          <p className="text-sm text-muted-foreground">
            Si ya instalaste tu billetera pero no ves Sepolia en la lista de redes, haz clic abajo para añadirla automáticamente:
          </p>
          <Button
            onClick={addSepoliaNetwork}
            className="bg-green-600 hover:bg-green-700 text-white font-medium"
          >
            Añadir Sepolia
          </Button>
        </div>

        {/* Help Section */}
        <div className="text-center space-y-2 pt-4">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <HelpCircle className="w-4 h-4" />
            <span className="font-medium">¿Necesitas Ayuda?</span>
          </div>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              • Descargar:{" "}
              <a
                href={wallets.find(w => w.name === selectedWallet)?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {selectedWallet} <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>
              • Ver:{" "}
              <a
                href="https://www.youtube.com/results?search_query=como+instalar+metamask"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Video Tutorial <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>• ¿Dudas? Contacta soporte</li>
          </ul>
        </div>

        {/* Close Button */}
        <div className="flex justify-center pt-4">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="px-8"
          >
            Cerrar
          </Button>
        </div>

        {/* Footer Links */}
        <div className="flex justify-center gap-4 pt-2 text-xs text-muted-foreground">
          <button className="hover:text-foreground transition-colors">
            Términos de Servicio
          </button>
          <button className="hover:text-foreground transition-colors">
            Política de Privacidad
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WalletTutorialModal;
