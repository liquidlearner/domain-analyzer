import { useMemo } from "react";
import { AlertCircle, Shield, Zap, Activity, Clock, Users, Server, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface OverviewTabProps {
  evaluation: any;
  analysisData?: any;
}

type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export default function OverviewTab({ evaluation, analysisData }: OverviewTabProps) {
  const {
    totalIncidents,
    noiseRatio,
    migrationComplexity,
    totalServices,
    riskLevel,
    shadowSignalCount,
    maintenanceBurden,
    mtta,
    mttr,
    autoResolved,
    apiResolvedPercent,
    apiResolvedCount,
    totalResolvedCount,
    pilotTeam,
    timelineEstimate,
    mappingBreakdown,
  } = useMemo(() => {
    const risk = analysisData?.risk;
    const noise = analysisData?.noise;
    const shadowStack = analysisData?.shadowStack;
    const meta = analysisData?.meta;
    const projectPlan = analysisData?.projectPlan;

    const totalIncidents = meta?.incidentCount || 0;
    // Use scoped service count from analysis (only services in evaluation scope), not total domain count
    const scopedCounts = analysisData?.scopedCounts;
    const totalServices = scopedCounts?.services
      || (evaluation.configSnapshot?.resources || []).filter((r: any) => r.pdType === "SERVICE").length;

    // Real noise ratio from analysis
    const noiseRatio = noise?.overallNoiseRatio != null
      ? Math.round(noise.overallNoiseRatio * 100)
      : meta?.noiseRatio != null
        ? Math.round(meta.noiseRatio * 100)
        : 0;

    // Migration complexity from risk analysis
    const complexityMap: Record<string, RiskLevel> = {
      low: "LOW",
      medium: "MEDIUM",
      high: "HIGH",
      very_high: "VERY_HIGH",
    };
    const migrationComplexity: RiskLevel = complexityMap[risk?.overallComplexity?.toLowerCase()] || "LOW";

    // Overall risk — combine complexity + noise + shadow stack
    let riskLevel: RiskLevel = migrationComplexity;
    if (noiseRatio > 60 || (shadowStack?.signals?.length || 0) > 10) {
      if (riskLevel === "LOW") riskLevel = "MEDIUM";
      else if (riskLevel === "MEDIUM") riskLevel = "HIGH";
    }

    // Shadow stack
    const shadowSignalCount = shadowStack?.signals?.length || meta?.shadowSignals || 0;
    const maintenanceBurden = shadowStack?.estimatedMaintenanceBurden || "low";

    // Noise metrics
    const mtta = noise?.meanTimeToAck || 0;
    const mttr = noise?.meanTimeToResolve || 0;
    const autoResolved = noise?.autoResolvedPercent || 0;
    const apiResolvedPercent = noise?.apiResolvedPercent || 0;
    const apiResolvedCount = noise?.apiResolvedCount || 0;
    const totalResolvedCount = noise?.totalResolved || 0;

    // Project plan
    const pilotTeam = projectPlan?.pilotRecommendations?.[0]?.teamName || null;
    const timelineEstimate = projectPlan?.overallTimeline?.totalWeeks
      ? `${projectPlan.overallTimeline.totalWeeks} weeks`
      : null;

    // Migration mapping breakdown
    const mappings = evaluation.migrationMappings || [];
    const mappingBreakdown = {
      auto: mappings.filter((m: any) => m.conversionStatus === "AUTO").length,
      manual: mappings.filter((m: any) => m.conversionStatus === "MANUAL").length,
      skip: mappings.filter((m: any) => m.conversionStatus === "SKIP").length,
      total: mappings.length,
    };

    return {
      totalIncidents,
      noiseRatio,
      migrationComplexity,
      totalServices,
      riskLevel,
      shadowSignalCount,
      maintenanceBurden,
      mtta,
      mttr,
      autoResolved,
      apiResolvedPercent,
      apiResolvedCount,
      totalResolvedCount,
      pilotTeam,
      timelineEstimate,
      mappingBreakdown,
    };
  }, [evaluation, analysisData]);

  const formatSeconds = (seconds: number) => {
    if (seconds === 0) return "N/A";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return `${Math.round(seconds)}s`;
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  const getRiskColor = (level: RiskLevel) => {
    switch (level) {
      case "LOW": return "text-green-700 bg-green-50 border-green-200";
      case "MEDIUM": return "text-yellow-700 bg-yellow-50 border-yellow-200";
      case "HIGH": return "text-orange-700 bg-orange-50 border-orange-200";
      case "VERY_HIGH": return "text-red-700 bg-red-50 border-red-200";
    }
  };

  const getRiskBadgeColor = (level: RiskLevel) => {
    switch (level) {
      case "LOW": return "bg-green-100 text-green-800";
      case "MEDIUM": return "bg-yellow-100 text-yellow-800";
      case "HIGH": return "bg-orange-100 text-orange-800";
      case "VERY_HIGH": return "bg-red-100 text-red-800";
    }
  };

  if (!analysisData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-zinc-500">Analysis data not available. Run a new evaluation to generate results.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Total Incidents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{totalIncidents.toLocaleString()}</p>
            <p className="text-xs text-zinc-500 mt-1">
              {analysisData?.meta?.periodStart && analysisData?.meta?.periodEnd
                ? `${new Date(analysisData.meta.periodStart).toLocaleDateString()} – ${new Date(analysisData.meta.periodEnd).toLocaleDateString()}`
                : "Analysis period"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Noise Ratio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{noiseRatio}%</p>
            <p className="text-xs text-zinc-500 mt-1">
              {noiseRatio > 50 ? "High alert fatigue" : noiseRatio > 25 ? "Moderate noise" : "Good signal quality"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600 flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> Services
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{totalServices}</p>
            <p className="text-xs text-zinc-500 mt-1">In evaluation scope</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Tool Stack Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{shadowSignalCount}</p>
            <p className="text-xs text-zinc-500 mt-1">
              Burden: <span className="capitalize font-medium">{maintenanceBurden}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Risk Assessment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Migration Risk Assessment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`p-6 rounded-lg border ${getRiskColor(riskLevel)}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Overall Migration Risk</p>
                <p className="text-2xl font-bold mt-2">{riskLevel.replace("_", " ")}</p>
              </div>
              <div className="text-right">
                <p className="text-xs opacity-75 mb-2">Complexity</p>
                <Badge className={getRiskBadgeColor(migrationComplexity)}>
                  {migrationComplexity.replace("_", " ")}
                </Badge>
              </div>
            </div>

            {/* Risk indicators */}
            <div className="grid grid-cols-4 gap-4 mt-6 pt-4 border-t border-current/10">
              <div>
                <p className="text-xs opacity-75">MTTA</p>
                <p className="font-semibold text-sm mt-1">{formatSeconds(mtta)}</p>
              </div>
              <div>
                <p className="text-xs opacity-75">MTTR</p>
                <p className="font-semibold text-sm mt-1">{formatSeconds(mttr)}</p>
              </div>
              <div>
                <p className="text-xs opacity-75">Auto-resolved</p>
                <p className="font-semibold text-sm mt-1">{autoResolved.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs opacity-75">API-Resolved</p>
                <p className={`font-semibold text-sm mt-1 ${apiResolvedPercent > 75 ? "text-amber-600" : ""}`}>{apiResolvedPercent.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Migration Mapping Breakdown */}
      {mappingBreakdown.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Resource Migration Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Bar visualization */}
              <div className="flex h-6 rounded-full overflow-hidden">
                {mappingBreakdown.auto > 0 && (
                  <div
                    className="bg-green-500 transition-all"
                    style={{ width: `${(mappingBreakdown.auto / mappingBreakdown.total) * 100}%` }}
                    title={`Auto: ${mappingBreakdown.auto}`}
                  />
                )}
                {mappingBreakdown.manual > 0 && (
                  <div
                    className="bg-yellow-500 transition-all"
                    style={{ width: `${(mappingBreakdown.manual / mappingBreakdown.total) * 100}%` }}
                    title={`Manual: ${mappingBreakdown.manual}`}
                  />
                )}
                {mappingBreakdown.skip > 0 && (
                  <div
                    className="bg-zinc-300 transition-all"
                    style={{ width: `${(mappingBreakdown.skip / mappingBreakdown.total) * 100}%` }}
                    title={`Skip: ${mappingBreakdown.skip}`}
                  />
                )}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <span className="text-zinc-700">Auto-convert: <strong>{mappingBreakdown.auto}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-yellow-500" />
                  <span className="text-zinc-700">Manual effort: <strong>{mappingBreakdown.manual}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-zinc-300" />
                  <span className="text-zinc-700">Skip/cleanup: <strong>{mappingBreakdown.skip}</strong></span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Insights */}
      <Card className="bg-primary-light border-primary-muted">
        <CardHeader>
          <CardTitle className="text-base">Quick Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pilotTeam && (
              <div className="flex items-start gap-3">
                <Users className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-zinc-800">
                  <strong>Recommended Pilot Team:</strong> {pilotTeam} — lowest complexity, ideal for 14-day POV
                </p>
              </div>
            )}
            {timelineEstimate && (
              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-zinc-800">
                  <strong>Estimated Migration Timeline:</strong> {timelineEstimate}
                </p>
              </div>
            )}
            {shadowSignalCount > 0 && (
              <div className="flex items-start gap-3">
                <Shield className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-zinc-800">
                  <strong>{shadowSignalCount} tool stack signal{shadowSignalCount !== 1 ? "s" : ""}</strong> detected
                  {maintenanceBurden === "high"
                    ? " — significant custom automation requiring migration planning"
                    : maintenanceBurden === "medium"
                      ? " — moderate custom tooling to address during migration"
                      : " — minimal custom dependencies"}
                </p>
              </div>
            )}
            {apiResolvedPercent > 50 && (
              <div className="flex items-start gap-3">
                <Zap className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-zinc-800">
                  <strong>{apiResolvedPercent.toFixed(0)}% of incidents resolved via API</strong> ({apiResolvedCount} of {totalResolvedCount})
                  — external automation is handling incident resolution, indicating a shadow tool stack managing the incident lifecycle outside PagerDuty
                </p>
              </div>
            )}
            {noiseRatio > 30 && (
              <div className="flex items-start gap-3">
                <Zap className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-zinc-800">
                  <strong>{noiseRatio}% noise ratio</strong> — incident.io&apos;s alert routing and deduplication can reduce alert fatigue significantly
                </p>
              </div>
            )}
            {mappingBreakdown.auto > 0 && (
              <div className="flex items-start gap-3">
                <BarChart3 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-zinc-800">
                  <strong>{Math.round((mappingBreakdown.auto / mappingBreakdown.total) * 100)}% of resources</strong> can be auto-converted to incident.io equivalents
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Analysis Summary */}
      <Card className="bg-zinc-50">
        <CardContent className="pt-6">
          <h3 className="font-semibold text-sm mb-3">Analysis Summary</h3>
          <p className="text-sm text-zinc-700 leading-relaxed">
            This PagerDuty domain generated <strong>{totalIncidents.toLocaleString()}</strong> incidents
            across <strong>{totalServices}</strong> service{totalServices !== 1 ? "s" : ""} with
            a <strong>{noiseRatio}%</strong> noise ratio
            {noiseRatio > 50 ? ", indicating significant alert fatigue" : noiseRatio > 25 ? ", showing moderate noise levels" : ", indicating good alert quality"}.
            {shadowSignalCount > 0
              ? ` ${shadowSignalCount} tool stack signal${shadowSignalCount !== 1 ? "s were" : " was"} detected with ${maintenanceBurden} maintenance burden.`
              : " No significant tool stack dependencies were detected."}
            {" "}The migration presents a <strong>{migrationComplexity.toLowerCase().replace("_", " ")}</strong> complexity
            level — {mappingBreakdown.auto > 0
              ? `${mappingBreakdown.auto} of ${mappingBreakdown.total} resources can be auto-converted`
              : `${mappingBreakdown.total} resources require migration`}.
            {pilotTeam ? ` We recommend starting a 14-day POV with ${pilotTeam}.` : ""}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
