import { useState } from "react";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Proposal {
  id: string;
  title: string;
  description: string;
  status: "active" | "approved" | "rejected";
  impact: "alto" | "medio" | "bajo";
  votesFor: number;
  votesAgainst: number;
  approvalPercent: number;
  proposedBy: string;
  proposerLevel: string;
  endsAt: string;
  levelBreakdown: {
    level: string;
    percent: number;
    votes: string;
  }[];
}

export const DAOSection = () => {
  const [activeTab, setActiveTab] = useState("all");

  const proposals: Proposal[] = [
    {
      id: "1",
      title: "Implementar sistema de recompensas por referidos",
      description: "Propuesta para crear un programa de incentivos donde los miembros reciban un 5% de comisión por cada nuevo usuario que refieran al sistema.",
      status: "active",
      impact: "alto",
      votesFor: 140,
      votesAgainst: 36,
      approvalPercent: 79.5,
      proposedBy: "Carlos Rodríguez",
      proposerLevel: "Nivel Leyenda",
      endsAt: "2024-06-20",
      levelBreakdown: [
        { level: "Nivel 1", percent: 80, votes: "40/45" },
        { level: "Nivel 2", percent: 75, votes: "60/68" },
        { level: "Nivel 3", percent: 79, votes: "48/52" },
        { level: "Leyenda", percent: 89, votes: "28/30" },
      ],
    },
    {
      id: "2",
      title: "Reducir comisión de retiro del 2% al 1.5%",
      description: "Propuesta para reducir la comisión de retiro y hacer el sistema más competitivo.",
      status: "active",
      impact: "medio",
      votesFor: 142,
      votesAgainst: 35,
      approvalPercent: 80.2,
      proposedBy: "María González",
      proposerLevel: "Nivel 3",
      endsAt: "2024-06-22",
      levelBreakdown: [
        { level: "Nivel 1", percent: 70, votes: "40/45" },
        { level: "Nivel 2", percent: 84, votes: "62/68" },
        { level: "Nivel 3", percent: 83, votes: "48/52" },
        { level: "Leyenda", percent: 81, votes: "27/30" },
      ],
    },
  ];

  const stats = {
    total: proposals.length,
    active: proposals.filter(p => p.status === "active").length,
    approved: proposals.filter(p => p.status === "approved").length,
    rejected: proposals.filter(p => p.status === "rejected").length,
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-cyan-500/20 text-cyan-400">Activa</Badge>;
      case "approved":
        return <Badge className="bg-green-500/20 text-green-400">Aprobada</Badge>;
      case "rejected":
        return <Badge className="bg-red-500/20 text-red-400">Rechazada</Badge>;
      default:
        return null;
    }
  };

  const getImpactBadge = (impact: string) => {
    switch (impact) {
      case "alto":
        return <Badge variant="outline" className="border-pink-500/50 text-pink-400">Impacto alto</Badge>;
      case "medio":
        return <Badge variant="outline" className="border-yellow-500/50 text-yellow-400">Impacto medio</Badge>;
      case "bajo":
        return <Badge variant="outline" className="border-green-500/50 text-green-400">Impacto bajo</Badge>;
      default:
        return null;
    }
  };

  const filteredProposals = proposals.filter((proposal) => {
    if (activeTab === "all") return true;
    if (activeTab === "active") return proposal.status === "active";
    if (activeTab === "approved") return proposal.status === "approved";
    if (activeTab === "rejected") return proposal.status === "rejected";
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-card">
            <TabsTrigger value="all">Todas</TabsTrigger>
            <TabsTrigger value="active">Activas</TabsTrigger>
            <TabsTrigger value="approved">Aprobadas</TabsTrigger>
            <TabsTrigger value="rejected">Rechazadas</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Nueva Propuesta
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Total Propuestas</p>
          <p className="text-3xl font-bold text-foreground">{stats.total}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Activas</p>
          <p className="text-3xl font-bold text-cyan-400">{stats.active}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Aprobadas</p>
          <p className="text-3xl font-bold text-green-400">{stats.approved}</p>
        </Card>
        <Card className="p-4 bg-card/50">
          <p className="text-sm text-muted-foreground">Rechazadas</p>
          <p className="text-3xl font-bold text-red-400">{stats.rejected}</p>
        </Card>
      </div>

      {/* Proposals List */}
      <div className="space-y-4">
        {filteredProposals.map((proposal) => (
          <Card key={proposal.id} className="p-6 bg-card/50">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-foreground">{proposal.title}</h3>
                  {getStatusBadge(proposal.status)}
                </div>
                {getImpactBadge(proposal.impact)}
              </div>

              {/* Description */}
              <p className="text-sm text-muted-foreground">{proposal.description}</p>

              {/* Votes */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {proposal.votesFor} a favor · {proposal.votesAgainst} en contra
                  </span>
                  <span className="text-foreground font-medium">{proposal.approvalPercent}% aprobación</span>
                </div>
                <Progress value={proposal.approvalPercent} className="h-2" />
              </div>

              {/* Level Breakdown */}
              <div className="grid grid-cols-4 gap-4 py-4 border-y border-border">
                {proposal.levelBreakdown.map((level, index) => (
                  <div key={index} className="text-center">
                    <p className="text-xs text-muted-foreground">{level.level}</p>
                    <p className="text-lg font-bold text-foreground">{level.percent}%</p>
                    <p className="text-xs text-muted-foreground">{level.votes}</p>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Propuesto por</span>
                  <span className="text-foreground">{proposal.proposedBy}</span>
                  <Badge className="bg-primary/20 text-primary">{proposal.proposerLevel}</Badge>
                </div>
                <span className="text-muted-foreground">Termina: {proposal.endsAt}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
