import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProfileData {
  full_name: string;
  phone: string;
  whatsapp: string | null;
  telegram: string | null;
}

interface ProfileEditDialogProps {
  userId: string;
  profile: ProfileData;
  onProfileUpdated: (data: ProfileData) => void;
  trigger?: React.ReactNode;
}

export const ProfileEditDialog = ({ userId, profile, onProfileUpdated, trigger }: ProfileEditDialogProps) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfileData>({
    full_name: profile.full_name,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    telegram: profile.telegram,
  });

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      setForm({
        full_name: profile.full_name,
        phone: profile.phone,
        whatsapp: profile.whatsapp,
        telegram: profile.telegram,
      });
    }
    setOpen(isOpen);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    if (!form.phone.trim()) {
      toast.error("El teléfono es obligatorio");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          whatsapp: form.whatsapp?.trim() || null,
          telegram: form.telegram?.trim() || null,
        })
        .eq("id", userId);

      if (error) throw error;

      onProfileUpdated(form);
      setOpen(false);
      toast.success("Perfil actualizado");
    } catch (error: any) {
      console.error("Error updating profile:", error);
      toast.error("Error al actualizar el perfil");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            <Pencil className="w-4 h-4" />
            Editar Perfil
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Perfil</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="full_name">Nombre completo *</Label>
            <Input
              id="full_name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="Tu nombre completo"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Teléfono *</Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+52 123 456 7890"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input
              id="whatsapp"
              value={form.whatsapp || ""}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              placeholder="+52 123 456 7890"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="telegram">Telegram</Label>
            <Input
              id="telegram"
              value={form.telegram || ""}
              onChange={(e) => setForm({ ...form, telegram: e.target.value })}
              placeholder="@usuario"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
