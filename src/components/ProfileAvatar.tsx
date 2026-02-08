import { useState, useRef } from "react";
import { Camera, Loader2, Upload } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AvatarCropDialog } from "@/components/AvatarCropDialog";

interface ProfileAvatarProps {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  onAvatarUpdated: (url: string) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const ProfileAvatar = ({ userId, fullName, avatarUrl, onAvatarUpdated }: ProfileAvatarProps) => {
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [showCropDialog, setShowCropDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleAvatarClick = () => {
    setShowPickerModal(true);
  };

  const handleSelectFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast.error("La imagen debe ser menor a 10MB");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Solo se permiten archivos de imagen");
      return;
    }

    // Close picker modal and open crop dialog
    setShowPickerModal(false);
    setPendingFile(file);
    setShowCropDialog(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCropConfirm = async (croppedFile: File) => {
    setShowCropDialog(false);
    setPendingFile(null);
    setUploading(true);

    try {
      const ext = "jpg";
      const filePath = `${userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, croppedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const urlWithCacheBuster = `${publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: urlWithCacheBuster })
        .eq("id", userId);

      if (updateError) throw updateError;

      onAvatarUpdated(urlWithCacheBuster);
      toast.success("Foto de perfil actualizada");
    } catch (error: any) {
      console.error("Error uploading avatar:", error);
      toast.error("Error al subir la imagen");
    } finally {
      setUploading(false);
    }
  };

  const handleCropCancel = () => {
    setShowCropDialog(false);
    setPendingFile(null);
  };

  return (
    <>
      {/* Avatar with hover overlay */}
      <div
        className="relative group cursor-pointer"
        onClick={handleAvatarClick}
        title="Toca para cambiar tu foto"
      >
        <Avatar className="w-20 h-20 border-2 border-border">
          <AvatarImage src={avatarUrl || undefined} alt={fullName} />
          <AvatarFallback className="bg-primary text-primary-foreground text-xl font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="absolute inset-0 rounded-full bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          {uploading ? (
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          ) : (
            <>
              <Camera className="w-5 h-5 text-white" />
              <span className="text-[9px] text-white mt-0.5 font-medium">Cambiar</span>
            </>
          )}
        </div>
      </div>

      {/* Picker modal — shows current avatar and upload option */}
      <Dialog open={showPickerModal} onOpenChange={setShowPickerModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Foto de perfil</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-2">
            {/* Current avatar large preview */}
            <Avatar className="w-40 h-40 border-2 border-border">
              <AvatarImage src={avatarUrl || undefined} alt={fullName} />
              <AvatarFallback className="bg-primary text-primary-foreground text-4xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>

            <Button onClick={handleSelectFile} className="w-full gap-2">
              <Upload className="w-4 h-4" />
              Seleccionar nueva foto
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Máximo 10MB · Formatos: JPG, PNG, WEBP
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Crop dialog */}
      <AvatarCropDialog
        open={showCropDialog}
        imageFile={pendingFile}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
    </>
  );
};
