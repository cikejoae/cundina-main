import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertCircle, Rocket, ExternalLink, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DeployResult {
  success: boolean;
  network: string;
  deployer: string;
  contracts: {
    CundinaBlockSecure: string;
    BlockRegistryFactory: string;
    SafeTreasuryPayoutModule: string;
  };
  configuration: {
    token: string;
    treasurySafe: string;
  };
  levels: Record<string, { members: number; contribution: string }>;
  nextStep: string;
  envUpdates: Record<string, string>;
}

export default function DeployContracts() {
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string>("");

  const handleDeploy = async () => {
    setIsDeploying(true);
    setError("");
    setDeployResult(null);

    try {
      console.log("🚀 Calling deploy-contracts edge function...");
      
      const { data, error: invokeError } = await supabase.functions.invoke('deploy-contracts', {
        body: {}
      });

      if (invokeError) {
        throw new Error(invokeError.message);
      }

      if (data.error) {
        throw new Error(data.error);
      }

      console.log("✅ Deployment successful:", data);
      setDeployResult(data);
      
      toast.success("¡Contratos desplegados exitosamente!", {
        description: "Revisa los pasos siguientes para completar la configuración"
      });

    } catch (err: any) {
      console.error("❌ Deployment failed:", err);
      setError(err.message || "Error desconocido al desplegar");
      toast.error("Error al desplegar", {
        description: err.message
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Desplegar Contratos V2</h1>
        <p className="text-muted-foreground">
          Arquitectura Safe Treasury + Registry + Payout Module en Sepolia
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Nuevo Sistema de Contratos
          </CardTitle>
          <CardDescription>
            Despliega los 3 contratos y los configura automáticamente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertDescription>
              <div className="space-y-3">
                <p className="font-semibold">Contratos a desplegar:</p>
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li><strong>CundinaBlockSecure</strong> - Template clonable (Implementation)</li>
                  <li><strong>BlockRegistryFactory</strong> - Registry principal</li>
                  <li><strong>SafeTreasuryPayoutModule</strong> - Módulo de pagos para Safe</li>
                </ol>
                <p className="text-sm text-muted-foreground mt-4">
                  El sistema automáticamente conectará el módulo con el registry.
                </p>
              </div>
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="ml-2 whitespace-pre-wrap">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {deployResult && (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription className="ml-2">
                  <div className="space-y-4">
                    <p className="font-semibold text-green-600">¡Despliegue exitoso!</p>
                    
                    <div className="grid gap-3">
                      <div className="text-sm">
                        <p className="font-medium mb-1">Contratos desplegados:</p>
                        <div className="space-y-1 font-mono text-xs">
                          {Object.entries(deployResult.contracts).map(([name, address]) => (
                            <div key={name} className="flex items-center justify-between bg-muted p-2 rounded">
                              <span>{name}:</span>
                              <div className="flex items-center gap-2">
                                <span className="truncate max-w-[200px]">{address}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => copyToClipboard(address)}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                                <a
                                  href={`https://sepolia.etherscan.io/address/${address}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="ml-2">
                  <div className="space-y-3">
                    <p className="font-semibold">⚠️ PASO CRÍTICO - Habilitar Módulo en Safe</p>
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>Ir a <a href="https://app.safe.global" target="_blank" rel="noopener noreferrer" className="underline">app.safe.global</a></li>
                      <li>Seleccionar tu Safe: <code className="bg-muted px-1 rounded">{deployResult.configuration.treasurySafe}</code></li>
                      <li>Ir a <strong>Settings → Modules</strong></li>
                      <li>Click <strong>Add custom module</strong></li>
                      <li>Pegar: <code className="bg-muted px-1 rounded">{deployResult.contracts.SafeTreasuryPayoutModule}</code></li>
                      <li>Confirmar la transacción</li>
                    </ol>
                    <p className="text-xs text-destructive-foreground/80 mt-2">
                      Sin este paso, las funciones cashout y advance NO funcionarán.
                    </p>
                  </div>
                </AlertDescription>
              </Alert>

              <div className="p-4 bg-muted rounded-lg">
                <p className="font-semibold mb-2">Variables de entorno para actualizar:</p>
                <div className="space-y-1 font-mono text-xs">
                  {Object.entries(deployResult.envUpdates).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span>{key}={value}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(`${key}=${value}`)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-muted rounded-lg">
                <p className="font-semibold mb-2">Niveles configurados:</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(deployResult.levels).map(([level, config]) => (
                    <div key={level} className="flex justify-between">
                      <span>{level}:</span>
                      <span>{config.members} miembros × {config.contribution}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <Button
              onClick={handleDeploy}
              disabled={isDeploying}
              size="lg"
              className="w-full"
            >
              {isDeploying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Desplegando (puede tomar 2-3 minutos)...
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  Desplegar Contratos V2
                </>
              )}
            </Button>
          </div>

          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Información del sistema:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Token USDT Test: 0xB15AfB9b896D3c9bCF1686de5c5ef8139345caB7</li>
              <li>Red: Sepolia Testnet</li>
              <li>Niveles: 1-7 (9→3 miembros, $20→$2,500)</li>
              <li>Fee: 10% de comisión</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
