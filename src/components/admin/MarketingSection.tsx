import { Share2, FolderOpen, PenSquare, Calendar, ListChecks, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const MarketingSection = () => {
  const stats = [
    { label: "Redes Conectadas", value: "4", color: "text-blue-400" },
    { label: "Posts Programados", value: "12", color: "text-purple-400" },
    { label: "Archivos en Biblioteca", value: "48", color: "text-green-400" },
    { label: "Posts Este Mes", value: "127", color: "text-pink-400" },
  ];

  const tools = [
    {
      icon: Share2,
      iconBg: "bg-blue-500/20",
      iconColor: "text-blue-400",
      title: "Integraciones",
      description: "Conecta y gestiona tus redes sociales",
      buttonText: "Abrir",
      buttonVariant: "outline" as const,
    },
    {
      icon: FolderOpen,
      iconBg: "bg-purple-500/20",
      iconColor: "text-purple-400",
      title: "Biblioteca de Contenidos",
      description: "Organiza imágenes, videos y recursos",
      buttonText: "Abrir",
      buttonVariant: "outline" as const,
    },
    {
      icon: PenSquare,
      iconBg: "bg-green-500/20",
      iconColor: "text-green-400",
      title: "Crear Publicación",
      description: "Crea y programa contenido para tus redes",
      buttonText: "Abrir",
      buttonVariant: "outline" as const,
    },
    {
      icon: Calendar,
      iconBg: "bg-yellow-500/20",
      iconColor: "text-yellow-400",
      title: "Calendario de Contenidos",
      description: "Visualiza y organiza tus publicaciones",
      buttonText: "Abrir",
      buttonVariant: "outline" as const,
    },
    {
      icon: ListChecks,
      iconBg: "bg-cyan-500/20",
      iconColor: "text-cyan-400",
      title: "Lista de Publicaciones",
      description: "Vista detallada de todos tus posts",
      buttonText: "Abrir",
      buttonVariant: "outline" as const,
    },
    {
      icon: Eye,
      iconBg: "bg-pink-500/20",
      iconColor: "text-pink-400",
      title: "Detalle de Publicación",
      description: "Vista completa de una publicación (Demo)",
      buttonText: "Ver Ejemplo",
      buttonVariant: "outline" as const,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Marketing y Contenido</h2>
        <p className="text-muted-foreground">Gestiona tus redes sociales, crea contenido y programa publicaciones</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <Card key={index} className="p-4 bg-card/50 border-border">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
          </Card>
        ))}
      </div>

      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool, index) => (
          <Card key={index} className="p-6 bg-card/50 border-border">
            <div className={`w-12 h-12 rounded-lg ${tool.iconBg} flex items-center justify-center mb-4`}>
              <tool.icon className={`w-6 h-6 ${tool.iconColor}`} />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">{tool.title}</h3>
            <p className="text-sm text-muted-foreground mb-4">{tool.description}</p>
            <Button 
              variant={tool.buttonVariant} 
              className="w-full border-primary/50 text-primary hover:bg-primary/10"
            >
              {tool.buttonText}
            </Button>
          </Card>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="text-lg">💡</span>
        <span>Centro de Marketing CundinaBlock</span>
      </div>
    </div>
  );
};
