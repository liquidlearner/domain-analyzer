import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Evaluation {
  id: string;
  incidentAnalyses: Array<{
    id: string;
    incidentCount: number;
  }>;
  migrationMappings: Array<{
    id: string;
    conversionStatus: "AUTO" | "MANUAL" | "SKIP" | "UNSUPPORTED";
  }>;
}

interface OverviewTabProps {
  evaluation: Evaluation;
}

type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export default function OverviewTab({ evaluation }: OverviewTabProps) {
  const { totalIncidents, noiseRatio, migrationComplexity, totalServices, riskLevel } = useMemo(
    () => {
      const analyses = evaluation.incidentAnalyses || [];
      const totalIncidents = analyses.reduce((sum, a) => sum + (a.incidentCount || 0), 0);
      const totalServices = analyses.length;

      // Estimate noise ratio from incident distribution
      const avgIncidentsPerService =
        totalServices > 0 ? totalIncidents / totalServices : 0;
      const noiseRatio = Math.min(totalServices > 0 ? avgIncidentsPerService / 50 : 0.2, 1.0);

      // Calculate migration complexity
      const mappings = evaluation.migrationMappings || [];
      const autoCount = mappings.filter((m) => m.conversionStatus === "AUTO").length;
      const manualCount = mappings.filter((m) => m.conversionStatus === "MANUAL").length;
      const totalMappings = mappings.length;

      let migrationComplexity: RiskLevel = "LOW";
      if (totalMappings === 0) {
        migrationComplexity = "LOW";
      } else {
        const manualRatio = totalMappings > 0 ? manualCount / totalMappings : 0;
        if (manualRatio > 0.7) {
          migrationComplexity = "VERY_HIGH";
        } else if (manualRatio > 0.5) {
          migrationComplexity = "HIGH";
        } else if (manualRatio > 0.2) {
          migrationComplexity = "MEDIUM";
        }
      }

      // Estimate overall risk
      let riskLevel: RiskLevel = "LOW";
      if (noiseRatio > 0.6 || migrationComplexity === "VERY_HIGH") {
        riskLevel = "VERY_HIGH";
      } else if (noiseRatio > 0.4 || migrationComplexity === "HIGH") {
        riskLevel = "HIGH";
      } else if (noiseRatio > 0.2 || migrationComplexity === "MEDIUM") {
        riskLevel = "MEDIUM";
      }

      return {
        totalIncidents,
        noiseRatio: Math.round(noiseRatio * 100),
        migrationComplexity,
        totalServices,
        riskLevel,
      };
    },
    [evaluation]
  );

  const getRiskColor = (level: RiskLevel) => {
    switch (level) {
      case "LOW":
        return "text-green-700 bg-green-50";
      case "MEDIUM":
        return "text-yellow-700 bg-yellow-50";
      case "HIGH":
        return "text-orange-700 bg-orange-50";
      case "VERY_HIGH":
        return "text-red-700 bg-red-50";
    }
  };

  const getRiskBadgeColor = (level: RiskLevel) => {
    switch (level) {
      case "LOW":
        return "bg-green-100 text-green-800";
      case "MEDIUM":
        return "bg-yellow-100 text-yellow-800";
      case "HIGH":
        return "bg-orange-100 text-orange-800";
      case "VERY_HIGH":
        return "bg-red-100 text-red-800";
    }
  };

  return (
    <div className="space-y-6">
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-600">Total Incidents</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{totalIncidents.toLocaleString()}</p>
            <p className="text-xs text-zinc-500 mt-1">Over analysis period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-600">Noise Ratio</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{noiseRatio}%</p>
            <p className="text-xs text-zinc-500 mt-1">Alert quality metric</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-600">Migration Complexity</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={`mb-2 ${getRiskBadgeColor(migrationComplexity)}`}>
              {migrationComplexity}
            </Badge>
            <p className="text-xs text-zinc-500 mt-1">Effort estimation</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-600">Total Services</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{totalServices}</p>
            <p className="text-xs text-zinc-500 mt-1">In analysis scope</p>
          </CardContent>
        </Card>
      </div>

      {/* Risk Score Card */}
      <Card>
        <CardHeader>
          <CardTitle>Overall Risk Assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`p-6 rounded-lg ${getRiskColor(riskLevel)}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Migration Risk Score</p>
                <p className="text-2xl font-bold mt-2">{riskLevel}</p>
              </div>
              <div className="text-right">
                <p className="text-xs opacity-75 mb-2">Complexity</p>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`h-2 w-8 rounded ${
                        i <= (riskLevel === "LOW" ? 1 : riskLevel === "MEDIUM" ? 2 : riskLevel === "HIGH" ? 3 : 5)
                          ? "bg-current opacity-100"
                          : "bg-current opacity-25"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Text */}
      <Card className="bg-zinc-50">
        <CardContent className="pt-6">
          <h3 className="font-semibold text-sm mb-3">Analysis Summary</h3>
          <p className="text-sm text-zinc-700 leading-relaxed">
            This PagerDuty instance is generating {totalIncidents.toLocaleString()} incidents across{" "}
            {totalServices} service{totalServices !== 1 ? "s" : ""} with a {noiseRatio}% noise ratio,
            indicating {noiseRatio > 50 ? "significant alert fatigue" : "good alert quality"}. The
            migration to incident.io presents a {migrationComplexity.toLowerCase()} complexity level with
            the current configuration. Review the detailed tabs below for specific recommendations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}