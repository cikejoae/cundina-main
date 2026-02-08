import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Shield, Lock, Eye, TrendingUp, Wallet, Users, Gift, RefreshCw, Star, ChevronDown, UserPlus } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readReferralCode } from "@/lib/contractReads";
import { usePublicClient } from "wagmi";
import { type Address } from "viem";
import logo from "@/assets/logo.png";

const levels = [{
  nivel: 1,
  nombre: "Curioso",
  aporte: 20,
  miembros: 9
}, {
  nivel: 2,
  nombre: "Soñador",
  aporte: 50,
  miembros: 8
}, {
  nivel: 3,
  nombre: "Novato",
  aporte: 100,
  miembros: 7
}, {
  nivel: 4,
  nombre: "Aprendiz",
  aporte: 250,
  miembros: 6
}, {
  nivel: 5,
  nombre: "Asesor",
  aporte: 500,
  miembros: 5
}, {
  nivel: 6,
  nombre: "Maestro",
  aporte: 1000,
  miembros: 4
}, {
  nivel: 7,
  nombre: "Leyenda",
  aporte: 2500,
  miembros: 3
}];

const howItWorks = [{
  number: 1,
  title: "Conecta tu billetera DEX",
  description: "Usa MetaMask para conectarte de forma segura.",
  icon: Wallet
}, {
  number: 2,
  title: "Aporta 20 USDT",
  description: "Realiza tu primer aporte de 20 USDT para entrar al Primer Nivel: Curioso y empezar a participar.",
  icon: Gift
}, {
  number: 3,
  title: "Crea o únete a un bloque",
  description: "Si creas un bloque, obtienes tu enlace único para invitar. Si te unis, formas parte de un bloque existente.",
  icon: Users
}, {
  number: 4,
  title: "Invita a personas a unirse a CundinaBlock",
  description: "Comparte tu enlace de invitación hasta completar el objetivo de miembros del nivel actual.",
  icon: TrendingUp
}, {
  number: 5,
  title: "Tu decides: Retirarte o Avanzar",
  description: "Al completarse el bloque (miembros por nivel), retira tus fondos (–10%) o avanzá automáticamente al siguiente nivel.",
  icon: RefreshCw
}, {
  number: 6,
  title: "Repeti hasta Leyenda",
  description: "Segui avanzando nivel por nivel hasta alcanzar la cima del sistema.",
  icon: Star
}];

const securityFeatures = [{
  title: "Smart Contracts",
  description: "Código verificable públicamente en la blockchain para máxima confianza.",
  icon: Shield
}, {
  title: "Aportes en USDT verificables",
  description: "Todas las transacciones son rastreables on-chain en tiempo real.",
  icon: Eye
}, {
  title: "Control total de tus fondos",
  description: "Tu cuenta en la plataforma CundinaBlock es tu billetera.",
  icon: Lock
}, {
  title: "Datos visibles en tiempo real",
  description: "Transparencia absoluta: mira el estado de tus bloques en tiempo real.",
  icon: TrendingUp
}];

const faqs = [{
  question: "¿Cuánto necesito para empezar?",
  answer: "Solo 20 USDT para unirte al Primer Nivel: Curioso."
}, {
  question: "¿Cómo conecto mi billetera?",
  answer: "Usa MetaMask u otra billetera compatible con Polygon para conectarte de forma segura."
}, {
  question: "¿Cómo funciona el sistema de retiro o avance?",
  answer: "Cuando tu bloque se completa, puedes retirar tus fondos (con 10% de comisión) o avanzar automáticamente al siguiente nivel."
}, {
  question: "¿Dónde puedo ver mis transacciones?",
  answer: "Todas las transacciones son visibles en la blockchain de Polygon. Puedes verlas en tu dashboard o en PolygonScan."
}, {
  question: "¿Qué es la DAO dentro de CundinaBlock?",
  answer: "La DAO permite a los participantes votar sobre decisiones importantes del sistema usando sus votos acumulados."
}, {
  question: "¿Puedo participar en más de un bloque al mismo tiempo?",
  answer: "Sí, puedes crear o unirte a múltiples bloques del mismo nivel simultáneamente."
}, {
  question: "¿Cuáles son los riesgos?",
  answer: "Los principales riesgos incluyen la volatilidad de criptomonedas y la dependencia de smart contracts. Siempre invierte lo que estás dispuesto a perder."
}];

const Landing = () => {
  const publicClient = usePublicClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [isJoiningPlatform, setIsJoiningPlatform] = useState(false);
  
  // Check if user came with referral code
  const referralCode = searchParams.get('ref');
  const hasReferral = !!referralCode;

  // Store referral code in localStorage and clear stale referrer context
  useEffect(() => {
    if (referralCode) {
      const storedRef = localStorage.getItem('referralCode');
      if (storedRef !== referralCode) {
        localStorage.removeItem('referrerSourceWalletAddress');
        localStorage.removeItem('referrerSourceBlockId');
      }
      localStorage.setItem('referralCode', referralCode);
    }
  }, [referralCode]);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({
      behavior: "smooth"
    });
  };

  // Handle "Unirme a CundinaBlock" button - gets next platform wallet
  const handleJoinPlatform = async () => {
    setIsJoiningPlatform(true);
    try {
      // Get next platform wallet from rotation
      const { data, error } = await supabase.rpc('get_next_platform_wallet');
      
      if (error) {
        console.error('Error getting platform wallet:', error);
        navigate('/auth');
        return;
      }

      if (data && publicClient) {
        // Read on-chain referral code for the platform wallet
        try {
          const onChainCode = await readReferralCode(publicClient, data as Address);
          if (onChainCode) {
            localStorage.setItem('referralCode', onChainCode);
            navigate(`/auth?ref=${onChainCode}`);
          } else {
            // Platform wallet not registered on-chain yet
            navigate('/auth');
          }
        } catch {
          navigate('/auth');
        }
      } else {
        navigate('/auth');
      }
    } catch (error) {
      console.error('Error in join platform:', error);
      navigate('/auth');
    } finally {
      setIsJoiningPlatform(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/95 backdrop-blur-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <img src={logo} alt="CundinaBlock" className="w-10 h-10 md:w-14 md:h-14" />
            <span className="text-lg md:text-xl lg:text-2xl font-bold">CundinaBlock</span>
          </div>
          
          <div className="hidden md:flex items-center gap-6 text-sm">
            <button onClick={() => scrollToSection("como-funciona")} className="text-white/80 hover:text-primary transition-colors">
              Cómo funciona
            </button>
            <button onClick={() => scrollToSection("niveles")} className="text-white/80 hover:text-primary transition-colors">
              Niveles
            </button>
            <button onClick={() => scrollToSection("seguridad")} className="text-white/80 hover:text-primary transition-colors">
              Seguridad
            </button>
            <button onClick={() => scrollToSection("faq")} className="text-white/80 hover:text-primary transition-colors">
              Preguntas frecuentes
            </button>
          </div>

          <Button onClick={() => navigate("/auth")} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
            Iniciar sesión
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="container mx-auto text-center max-w-5xl">
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
            Sistema de Cundina participativa con Tecnologia Blockchain, por niveles
          </h1>
          
          <p className="text-lg md:text-xl text-white/70 mb-8 max-w-3xl mx-auto">
            Conecta tu billetera, aporta USDT y empieza a participar en bloques de Cundina cada vez con mayores beneficios
          </p>

          {/* Feature Badges */}
          <div className="flex flex-wrap justify-center gap-4 mb-10">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 bg-white/5">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm">Contratos inteligentes</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 bg-white/5">
              <Lock className="w-4 h-4 text-primary" />
              <span className="text-sm">Sin intermediarios</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 bg-white/5">
              <Eye className="w-4 h-4 text-primary" />
              <span className="text-sm">Ganancias visibles en blockchain</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 bg-white/5">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-sm">Transacciones automatizadas</span>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            {/* Show different buttons based on referral */}
            {hasReferral ? (
              // User came with referral - show only connect button
              <Button 
                onClick={() => navigate(`/auth?ref=${referralCode}`)} 
                size="lg" 
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base px-8 h-12"
              >
                Conectar billetera y unirse
              </Button>
            ) : (
              // No referral - show both buttons
              <>
                <Button 
                  onClick={handleJoinPlatform} 
                  size="lg" 
                  disabled={isJoiningPlatform}
                  className="bg-success hover:bg-success/90 text-success-foreground font-semibold text-base px-8 h-12"
                >
                  {isJoiningPlatform ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-2" />
                  )}
                  Unirme a CundinaBlock
                </Button>
                <Button 
                  onClick={() => navigate("/auth")} 
                  size="lg" 
                  variant="outline" 
                  className="bg-black border-2 border-primary text-primary hover:bg-primary hover:text-black font-semibold text-base px-8 h-12"
                >
                  Ya tengo invitación
                </Button>
              </>
            )}
            <Button 
              onClick={() => scrollToSection("como-funciona")} 
              size="lg" 
              variant="ghost" 
              className="text-white/70 hover:text-white font-semibold text-base px-8 h-12"
            >
              Ver cómo funciona
            </Button>
          </div>

          {/* Referral indicator */}
          {hasReferral && (
            <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/20 border border-success/30">
              <Users className="w-4 h-4 text-success" />
              <span className="text-sm text-success">Tienes una invitación activa</span>
            </div>
          )}
        </div>
      </section>

      {/* How It Works Section */}
      <section id="como-funciona" className="py-20 px-4 bg-white/5">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-12">
            Cómo funciona CundinaBlock
          </h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {howItWorks.map(step => <Card key={step.number} className="p-6 bg-white/5 border-white/10 hover:border-primary/50 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary text-black flex items-center justify-center font-bold text-xl flex-shrink-0">
                    {step.number}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-lg mb-2 text-white">{step.title}</h3>
                    <p className="text-white/70 text-sm">{step.description}</p>
                  </div>
                </div>
              </Card>)}
          </div>

          <p className="text-center text-white/70">
            Las operaciones se realizan directamente desde tu billetera.
          </p>
        </div>
      </section>

      {/* Levels Section */}
      <section id="niveles" className="py-20 px-4">
        <div className="container mx-auto max-w-7xl">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-4">
            Niveles y aportes
          </h2>
          <p className="text-center text-white/70 mb-12">
            Comisión de plataforma: 10%
          </p>

          <div className="relative mb-12">
            {/* Level Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {levels.map((level, index) => <Card key={level.nivel} className={`p-6 bg-white/5 border-white/10 relative ${index === 0 ? 'ring-2 ring-primary' : ''}`}>
                  {index === 0 && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-black px-3 py-1 rounded-full text-xs font-bold">
                      INICIO
                    </div>}
                  
                  <div className="text-xs text-white/60 mb-2">Nivel {level.nivel}</div>
                  <h3 className="text-xl font-bold mb-4 text-white">
                    Nivel {level.nivel} — {level.nombre}
                  </h3>
                  
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-white/60 mb-1">Aporte</div>
                      <div className="text-2xl font-bold text-primary">{level.aporte} USDT</div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-white/60 mb-1">Miembros</div>
                      <div className="text-xl font-bold text-white">{level.miembros}</div>
                    </div>
                  </div>
                </Card>)}
            </div>
          </div>

          <div className="bg-white/5 border border-primary/30 rounded-lg p-4 text-center">
            <p className="text-sm text-white">
              💡 Si decides avanzar, se descuenta automáticamente el aporte del siguiente nivel desde tus fondos.
            </p>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="seguridad" className="py-20 px-4 bg-white/5">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-12">
            Seguridad y transparencia
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            {securityFeatures.map((feature, index) => <Card key={index} className="p-6 bg-white/5 border-white/10">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <feature.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg mb-2 text-white">{feature.title}</h3>
                    <p className="text-white/70 text-sm">{feature.description}</p>
                  </div>
                </div>
              </Card>)}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Conecta tu billetera y empieza a participar hoy</h2>
          <p className="text-lg text-white/70 mb-8">
            Aporta 20 USDT y forma parte del Primer Nivel: Curioso. Desde ahí puedes avanzar nivel por nivel.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {!hasReferral && (
              <Button 
                onClick={handleJoinPlatform} 
                size="lg" 
                disabled={isJoiningPlatform}
                className="bg-success hover:bg-success/90 text-success-foreground font-semibold text-base px-8 h-12"
              >
                {isJoiningPlatform ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" />
                )}
                Unirme a CundinaBlock
              </Button>
            )}
            <Button 
              onClick={() => navigate(hasReferral ? `/auth?ref=${referralCode}` : "/auth")} 
              size="lg" 
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base px-8 h-12"
            >
              {hasReferral ? "Conectar con mi invitación" : "Ya tengo invitación"}
            </Button>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 px-4 bg-white/5">
        <div className="container mx-auto max-w-3xl">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-12">
            Preguntas frecuentes
          </h2>

          <div className="space-y-4">
            {faqs.map((faq, index) => <Card key={index} className="bg-white/5 border-white/10 overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === index ? null : index)} className="w-full p-6 text-left flex items-center justify-between hover:bg-white/5 transition-colors">
                  <h3 className="font-bold text-lg pr-4 text-white">{faq.question}</h3>
                  <ChevronDown className={`w-5 h-5 flex-shrink-0 transition-transform text-white ${openFaq === index ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === index && <div className="px-6 pb-6 text-white/70">
                    {faq.answer}
                  </div>}
              </Card>)}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t border-white/10">
        <div className="container mx-auto text-center">
          <div className="flex items-center justify-center gap-2 md:gap-3 mb-4">
            <img src={logo} alt="CundinaBlock" className="w-10 h-10 md:w-12 md:h-12" />
            <span className="text-xl md:text-2xl font-bold text-white">CundinaBlock</span>
          </div>
          <p className="text-white/70 text-sm mb-4">
            Sistema de cundina descentralizado en blockchain
          </p>
          <div className="text-xs text-white/60">
            © 2024 CundinaBlock. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
