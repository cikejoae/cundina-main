import { useState } from "react";
import { Search, MessageSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface Ticket {
  id: string;
  title: string;
  description: string;
  user: string;
  userInitials: string;
  category: string;
  priority: string;
  status: "open" | "in_progress" | "resolved";
  assignedTo: string;
  createdAt: string;
  updatedAt: string;
  comments: number;
}

export const SupportSection = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const tickets: Ticket[] = [
    {
      id: "1",
      title: "No puedo completar mi registro",
      description: "He intentado completar mi registro pero el formulario no me permite avanzar después de ingresar mi billetera.",
      user: "Juan Pérez",
      userInitials: "JP",
      category: "registro",
      priority: "alta",
      status: "open",
      assignedTo: "Admin 1",
      createdAt: "2024-06-15 10:30",
      updatedAt: "2024-06-15 14:20",
      comments: 3,
    },
    {
      id: "2",
      title: "Problema con transferencia USDT",
      description: "Realicé una transferencia hace 2 horas pero aún no se refleja en mi cuenta.",
      user: "María González",
      userInitials: "MG",
      category: "pagos",
      priority: "urgente",
      status: "in_progress",
      assignedTo: "Admin 2",
      createdAt: "2024-06-14 16:45",
      updatedAt: "2024-06-15 09:15",
      comments: 5,
    },
    {
      id: "3",
      title: "Sugerencia: Modo oscuro en la app",
      description: "Sería genial tener un modo oscuro en la aplicación móvil.",
      user: "Carlos Rodríguez",
      userInitials: "CR",
      category: "mejoras",
      priority: "baja",
      status: "resolved",
      assignedTo: "Admin 1",
      createdAt: "2024-06-10 11:20",
      updatedAt: "2024-06-13 18:30",
      comments: 8,
    },
  ];

  const stats = {
    total: tickets.length,
    open: tickets.filter(t => t.status === "open").length,
    inProgress: tickets.filter(t => t.status === "in_progress").length,
    resolved: tickets.filter(t => t.status === "resolved").length,
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge className="bg-yellow-500/20 text-yellow-400">Abierto</Badge>;
      case "in_progress":
        return <Badge className="bg-blue-500/20 text-blue-400">En Progreso</Badge>;
      case "resolved":
        return <Badge className="bg-green-500/20 text-green-400">Resuelto</Badge>;
      default:
        return null;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgente":
        return <Badge variant="outline" className="border-red-500/50 text-red-400">urgente</Badge>;
      case "alta":
        return <Badge variant="outline" className="border-orange-500/50 text-orange-400">alta</Badge>;
      case "baja":
        return <Badge variant="outline" className="border-green-500/50 text-green-400">baja</Badge>;
      default:
        return <Badge variant="outline">{priority}</Badge>;
    }
  };

  const filteredTickets = tickets.filter((ticket) => {
    const matchesSearch =
      ticket.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.user.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || ticket.category === categoryFilter;
    const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <Card className="p-4 bg-card/50">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por asunto, usuario o correo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-background"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              <SelectItem value="registro">Registro</SelectItem>
              <SelectItem value="pagos">Pagos</SelectItem>
              <SelectItem value="mejoras">Mejoras</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="open">Abierto</SelectItem>
              <SelectItem value="in_progress">En Progreso</SelectItem>
              <SelectItem value="resolved">Resuelto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Total Tickets</p>
          <p className="text-3xl font-bold text-foreground">{stats.total}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Abiertos</p>
          <p className="text-3xl font-bold text-yellow-400">{stats.open}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">En Progreso</p>
          <p className="text-3xl font-bold text-blue-400">{stats.inProgress}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Resueltos</p>
          <p className="text-3xl font-bold text-green-400">{stats.resolved}</p>
        </Card>
      </div>

      {/* Tickets List */}
      <div className="space-y-4">
        {filteredTickets.map((ticket) => (
          <Card key={ticket.id} className="p-6 bg-card/50">
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-foreground">{ticket.title}</h3>
                  {getStatusBadge(ticket.status)}
                </div>
              </div>
              
              <p className="text-sm text-muted-foreground">{ticket.description}</p>
              
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Avatar className="w-6 h-6">
                    <AvatarFallback className="text-xs bg-primary/20 text-primary">
                      {ticket.userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-foreground">{ticket.user}</span>
                </div>
                <Badge variant="outline" className="border-muted">{ticket.category}</Badge>
                {getPriorityBadge(ticket.priority)}
                <span className="text-sm text-muted-foreground">
                  Asignado a: <span className="text-foreground">{ticket.assignedTo}</span>
                </span>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MessageSquare className="w-4 h-4" />
                  <span className="text-sm">{ticket.comments}</span>
                </div>
              </div>

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Creado: {ticket.createdAt}</span>
                <span>Última actualización: {ticket.updatedAt}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
