import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ChevronLeft, Loader2, Mail, CheckCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import logo from "@/assets/logo.png";

const emailSchema = z.string().trim().email({ message: "Email inválido" }).max(255);
const phoneSchema = z.string().trim().min(10, { message: "Teléfono inválido" }).max(20);
const firstNameSchema = z.string().trim().min(2, { message: "El nombre debe tener al menos 2 caracteres" }).max(50);
const lastNameSchema = z
  .string()
  .trim()
  .min(2, { message: "Los apellidos deben tener al menos 2 caracteres" })
  .max(80)
  // En LATAM suele requerirse 2 apellidos: valida que haya al menos 2 palabras.
  .refine((val) => val.split(/\s+/).filter(Boolean).length >= 2, {
    message: "Ingresa tus 2 apellidos",
  });
const passwordSchema = z.string().min(6, { message: "La contraseña debe tener al menos 6 caracteres" });

const RegisterForm = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, signUp, resendVerificationEmail } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showVerificationScreen, setShowVerificationScreen] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [telegram, setTelegram] = useState("");

  const referralCode = searchParams.get('ref');

  useEffect(() => {
    if (user) {
      navigate("/dashboard");
      return;
    }
  }, [user, navigate]);

  // Cooldown timer for resend button
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate inputs
    try {
      firstNameSchema.parse(firstName);
      lastNameSchema.parse(lastName);
      emailSchema.parse(email);
      phoneSchema.parse(phone);
      passwordSchema.parse(password);
      
      if (password !== confirmPassword) {
        toast.error("Las contraseñas no coinciden");
        return;
      }
      
      if (whatsapp && whatsapp.trim()) {
        phoneSchema.parse(whatsapp);
      }
      
      if (telegram && telegram.trim() && !telegram.startsWith('@')) {
        toast.error("El usuario de Telegram debe comenzar con @");
        return;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    setIsLoading(true);
    try {
      let walletReferralCode = null;
      if (referralCode) {
        const { data: referrerWallet } = await supabase
          .from('user_wallets')
          .select('id')
          .eq('referral_code', referralCode)
          .maybeSingle();
        
        if (referrerWallet) {
          walletReferralCode = referralCode;
        }
      }

      const userData = {
        full_name: `${firstName.trim()} ${lastName.trim()}`,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        whatsapp: whatsapp?.trim() || null,
        telegram: telegram?.trim() || null,
        wallet_referral_code: walletReferralCode
      };

      const { error, needsEmailVerification } = await signUp(email.trim().toLowerCase(), password, userData);
      
      if (!error) {
        if (needsEmailVerification) {
          setRegisteredEmail(email.trim().toLowerCase());
          setShowVerificationScreen(true);
          setResendCooldown(60);
        } else {
          toast.success("¡Cuenta creada exitosamente!");
          navigate("/dashboard");
        }
      }
    } catch (error) {
      console.error('Registration error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendEmail = async () => {
    if (resendCooldown > 0) return;
    
    setIsLoading(true);
    await resendVerificationEmail(registeredEmail);
    setResendCooldown(60);
    setIsLoading(false);
  };

  // Email Verification Screen
  if (showVerificationScreen) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 space-y-6 text-center bg-card border-border">
          <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto">
            <Mail className="w-10 h-10 text-primary" />
          </div>
          
          <div className="space-y-3">
            <h1 className="text-2xl font-bold">Verifica tu Email</h1>
            <p className="text-muted-foreground">
              Hemos enviado un enlace de verificación a:
            </p>
            <p className="font-semibold text-primary">{registeredEmail}</p>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Revisa tu bandeja de entrada</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Revisa la carpeta de spam</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Haz clic en el enlace para activar tu cuenta</span>
            </div>
          </div>

          <div className="space-y-3 pt-4">
            <Button
              onClick={handleResendEmail}
              variant="outline"
              className="w-full"
              disabled={resendCooldown > 0 || isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : resendCooldown > 0 ? (
                `Reenviar en ${resendCooldown}s`
              ) : (
                "Reenviar email de verificación"
              )}
            </Button>
            
            <Button
              onClick={() => navigate("/auth")}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Ir a Iniciar Sesión
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            ¿Email incorrecto?{" "}
            <button
              onClick={() => setShowVerificationScreen(false)}
              className="text-primary hover:underline"
            >
              Volver al registro
            </button>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-background">
      {/* Header */}
      <div className="bg-header text-header-foreground p-4 fixed top-0 left-0 right-0 z-10">
        <div className="container mx-auto flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="p-2">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-3">
            <img src={logo} alt="CundinaBlock" className="w-8 h-8" />
            <span className="text-lg font-bold">Cundina Block</span>
          </div>
          <div className="w-10" />
        </div>
      </div>

      <div className="container mx-auto px-4 pt-24">
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold">Crear Cuenta</h1>
            <p className="text-sm text-muted-foreground">
              Completa tu información para unirte a la plataforma.
            </p>
          </div>

          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Input
                  placeholder="Nombre"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="bg-card text-card-foreground border-border h-12 rounded-xl"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">*</span>
              </div>
              <div className="relative">
                <Input
                  placeholder="Apellidos"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="bg-card text-card-foreground border-border h-12 rounded-xl"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">*</span>
              </div>
            </div>

            <div className="relative">
              <Input
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-card text-card-foreground border-border h-12 rounded-xl"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">*</span>
            </div>

            <div className="relative">
              <Input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-card text-card-foreground border-border h-12 rounded-xl"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">*</span>
            </div>

            <div className="relative">
              <Input
                type="password"
                placeholder="Confirmar contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="bg-card text-card-foreground border-border h-12 rounded-xl"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">*</span>
            </div>

            <div className="relative">
              <Input
                type="tel"
                placeholder="+52 123 456 7890"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="bg-card text-card-foreground border-border h-12 rounded-xl"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary">*</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                type="tel"
                placeholder="WhatsApp (opcional)"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="bg-card text-card-foreground border-border h-12 rounded-xl"
              />
              <Input
                placeholder="@telegram (opcional)"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                className="bg-card text-card-foreground border-border h-12 rounded-xl"
              />
            </div>

            <Button 
              type="submit"
              disabled={isLoading}
              className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-base font-semibold"
            >
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Crear Cuenta
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link 
              to="/auth" 
              className="text-primary hover:underline font-medium"
            >
              Inicia sesión
            </Link>
          </p>

          <p className="text-xs text-center text-muted-foreground">
            Al registrarte, aceptas nuestros Términos y Condiciones
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterForm;
