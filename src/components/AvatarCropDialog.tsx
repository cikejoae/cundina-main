import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, ZoomOut, RotateCcw, Check, X } from "lucide-react";

interface AvatarCropDialogProps {
  open: boolean;
  imageFile: File | null;
  onConfirm: (croppedFile: File) => void;
  onCancel: () => void;
}

export const AvatarCropDialog = ({ open, imageFile, onConfirm, onCancel }: AvatarCropDialogProps) => {
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load image when file changes
  useState(() => {
    if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setPreviewUrl(url);
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
      };
      img.src = url;
      // Reset transforms
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      return () => URL.revokeObjectURL(url);
    }
  });

  const handleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    const point = "touches" in e ? e.touches[0] : e;
    setDragStart({ x: point.clientX - offsetX, y: point.clientY - offsetY });
  }, [offsetX, offsetY]);

  const handleMouseMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    const point = "touches" in e ? e.touches[0] : e;
    setOffsetX(point.clientX - dragStart.x);
    setOffsetY(point.clientY - dragStart.y);
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleReset = () => {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  };

  const handleConfirm = async () => {
    if (!imgRef.current || !imageFile) return;

    const canvas = document.createElement("canvas");
    const size = 400; // Output size
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const img = imgRef.current;
    const containerSize = 280;
    const scale = zoom;

    // Calculate the crop area
    const imgAspect = img.width / img.height;
    let drawW: number, drawH: number;
    if (imgAspect > 1) {
      drawH = containerSize * scale;
      drawW = drawH * imgAspect;
    } else {
      drawW = containerSize * scale;
      drawH = drawW / imgAspect;
    }

    const drawX = (containerSize - drawW) / 2 + offsetX;
    const drawY = (containerSize - drawH) / 2 + offsetY;

    // Map from container coords to output canvas
    const scaleOut = size / containerSize;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, drawX * scaleOut, drawY * scaleOut, drawW * scaleOut, drawH * scaleOut);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], imageFile.name, { type: "image/jpeg" });
          onConfirm(file);
        }
      },
      "image/jpeg",
      0.9
    );
  };

  if (!previewUrl) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar foto de perfil</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {/* Crop area */}
          <div
            ref={containerRef}
            className="relative w-[280px] h-[280px] overflow-hidden rounded-full border-2 border-primary/30 cursor-grab active:cursor-grabbing bg-muted"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
          >
            <img
              src={previewUrl}
              alt="Preview"
              className="absolute select-none pointer-events-none"
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
            />
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-3 w-full max-w-[280px]">
            <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider
              value={[zoom]}
              onValueChange={(v) => setZoom(v[0])}
              min={0.5}
              max={3}
              step={0.05}
              className="flex-1"
            />
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
            <Button variant="ghost" size="icon" onClick={handleReset} className="h-8 w-8 shrink-0">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Arrastra para mover · Usa el control para hacer zoom
          </p>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            <X className="w-4 h-4 mr-1" />
            Cancelar
          </Button>
          <Button onClick={handleConfirm} className="flex-1">
            <Check className="w-4 h-4 mr-1" />
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
