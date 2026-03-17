import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { formatDate } from "@/lib/utils";
import { PrintButton } from "./print-button";
import { decompressJson } from "@/lib/compression";

interface ReportPageProps {
  params: Promise<{
    id: string;
  }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function formatSeconds(seconds: number) {
  if (!seconds || seconds === 0) return "N/A";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${Math.round(seconds)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { id } = await params;
  const evaluation: any = await prisma.evaluation.findUnique({
    where: { id },
    include: {
      domain: {
        include: {
          customer: true,
        },
      },
      createdBy: true,
      configSnapshot: true,
      incidentAnalyses: {
        orderBy: { periodStart: "desc" },
      },
      migrationMappings: {
        include: {
          pdResource: {
            select: {
              id: true,
              pdType: true,
              pdId: true,
              name: true,
              teamIds: true,
            },
          },
        },
      },
    },
  });

  if (!evaluation) {
    notFound();
  }

  // Fetch config resources separately to handle null configSnapshotId
  let configResources: any[] = [];
  if (evaluation.configSnapshot?.id) {
    const snap = await prisma.configSnapshot.findUnique({
      where: { id: evaluation.configSnapshot.id },
      include: {
        resources: {
          select: { id: true, pdType: true, pdId: true, name: true },
        },
      },
    });
    configResources = snap?.resources || [];
  }

  const customer = evaluation.domain.customer;
  const incidentData = evaluation.incidentAnalyses[0];

  // Deserialize analysis data
  let sourcesData: any = {};
  let patternsData: any = {};
  if (incidentData) {
    try {
      sourcesData = decompressJson(incidentData.sourcesJson);
    } catch { /* empty */ }
    try {
      patternsData = decompressJson(incidentData.patternsJson);
    } catch { /* empty */ }
  }

  const volume = sourcesData.volume || {};
  const sources = sourcesData.sources || {};
  const risk = sourcesData.risk || {};
  const shadowStack = sourcesData.shadowStack || {};
  const projectPlan = sourcesData.projectPlan || {};
  const noise = patternsData;

  // Calculate statistics — use scoped count (only services in evaluation scope) if available
  const scopedCounts = sourcesData.scopedCounts;
  const totalServices = scopedCounts?.services
    || configResources.filter((r: any) => r.pdType === "SERVICE").length;
  const autoConversions = evaluation.migrationMappings.filter(
    (m: any) => m.conversionStatus === "AUTO"
  ).length;
  const manualConversions = evaluation.migrationMappings.filter(
    (m: any) => m.conversionStatus === "MANUAL"
  ).length;
  const skipConversions = evaluation.migrationMappings.filter(
    (m: any) => m.conversionStatus === "SKIP"
  ).length;
  const unsupportedResources = evaluation.migrationMappings.filter(
    (m: any) => m.conversionStatus === "UNSUPPORTED"
  ).length;

  // Group resources by type
  const resourcesByType: Record<string, number> = {};
  configResources.forEach((r: any) => {
    resourcesByType[r.pdType] = (resourcesByType[r.pdType] || 0) + 1;
  });

  // Real analysis metrics
  const noiseRatio = noise?.overallNoiseRatio || incidentData?.noiseRatio || 0;
  const complexityRating = risk?.overallComplexity || (noiseRatio > 0.3 ? "high" : "medium");
  const shadowSignals: any[] = shadowStack?.signals || [];
  const maintenanceBurden = shadowStack?.estimatedMaintenanceBurden || "low";
  const mtta = noise?.meanTimeToAck || 0;
  const mttr = noise?.meanTimeToResolve || 0;
  const autoResolved = noise?.autoResolvedPercent || 0;
  const escalated = noise?.escalatedPercent || 0;

  // Top noisiest services from real data
  const topNoisiest = volume?.topNoisiest || [];

  // Project plan data
  const pilots: any[] = projectPlan?.pilotRecommendations || [];
  const teams: any[] = projectPlan?.teams || [];
  const phases: any[] = projectPlan?.phases || [];
  const timeline = projectPlan?.overallTimeline || {};

  // Source breakdown
  const alertSources: any[] = sources?.sources || [];

  // Migration effort
  const totalMappings = evaluation.migrationMappings.length;
  const conversionRate =
    totalMappings > 0
      ? Math.round(((autoConversions + manualConversions) / totalMappings) * 100)
      : 0;

  // Period info
  const periodStart = incidentData?.periodStart
    ? new Date(incidentData.periodStart).toLocaleDateString()
    : "N/A";
  const periodEnd = incidentData?.periodEnd
    ? new Date(incidentData.periodEnd).toLocaleDateString()
    : "N/A";

  return (
    <div className="relative">
      {/* Screen-only controls */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-zinc-200 p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href={`/evaluations/${id}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Evaluation
            </Button>
          </Link>
          <PrintButton />
        </div>
      </div>

      {/* Report Content */}
      <div className="max-w-6xl mx-auto p-8 bg-white">
        {/* Header Section */}
        <div className="page-break pb-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-zinc-900 mb-2">
              PagerDuty → incident.io Migration Assessment
            </h1>
            <p className="text-lg text-zinc-600">
              Technical evaluation, tool stack analysis, and migration roadmap
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 mt-12 border-t border-b border-zinc-200 py-6">
            <div>
              <p className="text-sm font-semibold text-zinc-600 uppercase tracking-wide">
                Customer
              </p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">
                {customer.name}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-600 uppercase tracking-wide">
                Domain
              </p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">
                {evaluation.domain?.subdomain || "Unknown"}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-600 uppercase tracking-wide">
                Analysis Period
              </p>
              <p className="text-lg text-zinc-900 mt-1">
                {periodStart} – {periodEnd}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-600 uppercase tracking-wide">
                Report Generated
              </p>
              <p className="text-lg text-zinc-900 mt-1">
                {formatDate(new Date())}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold text-zinc-600 uppercase tracking-wide mb-2">
              Scope
            </p>
            <p className="text-zinc-900">
              {evaluation.scopeType === "SERVICE" ? "Services" : "Teams"}:{" "}
              {evaluation.scopeIds.length} resource
              {evaluation.scopeIds.length !== 1 ? "s" : ""} |{" "}
              {incidentData?.incidentCount?.toLocaleString() || 0} incidents analyzed
            </p>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Executive Summary
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">
                Incidents Analyzed
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-2">
                {(incidentData?.incidentCount || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">
                Migration Complexity
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-2 capitalize">
                {complexityRating}
              </p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">
                Tool Stack Signals
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-2">
                {shadowSignals.length}
              </p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">
                Auto-Convert Rate
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-2">
                {totalMappings > 0 ? Math.round((autoConversions / totalMappings) * 100) : 0}%
              </p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <p className="text-sm text-blue-900 font-semibold mb-2">
              Migration Readiness
            </p>
            <p className="text-blue-800 text-sm">
              This PagerDuty domain has <strong>{totalMappings}</strong> resources across{" "}
              <strong>{totalServices}</strong> services.{" "}
              <strong>{conversionRate}%</strong> of resources can be automatically or manually converted to incident.io equivalents.
              {shadowSignals.length > 0
                ? ` ${shadowSignals.length} tool stack signal${shadowSignals.length !== 1 ? "s were" : " was"} detected with ${maintenanceBurden} maintenance burden, requiring migration planning for custom automation and integrations.`
                : " No significant tool stack dependencies were detected."}
              {noiseRatio > 0.3
                ? " High alert noise levels present an opportunity to improve alerting quality during migration."
                : ""}
            </p>
          </div>

          {/* POV Recommendation */}
          {pilots.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <p className="text-sm text-green-900 font-semibold mb-2">
                POV Recommendation
              </p>
              <p className="text-green-800 text-sm">
                We recommend starting a <strong>14-day Proof of Value</strong> with{" "}
                <strong>{pilots[0].teamName}</strong>
                {pilots[0].reasons?.length > 0 ? ` — ${pilots[0].reasons[0].toLowerCase()}` : ""}.
                {pilots.length > 1 && ` ${pilots[1].teamName} is a strong secondary candidate.`}
                {timeline.totalWeeks && (
                  <> Based on analysis, the full migration is estimated at <strong>{timeline.totalWeeks} weeks</strong>
                  {timeline.totalEffortDays ? ` (${timeline.totalEffortDays} person-days)` : ""}.</>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Operational Reality */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Operational Reality
          </h2>

          {/* Noise & Response Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">Noise Ratio</p>
              <p className="text-2xl font-bold text-zinc-900 mt-2">
                {(noiseRatio * 100).toFixed(1)}%
              </p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">MTTA</p>
              <p className="text-2xl font-bold text-zinc-900 mt-2">{formatSeconds(mtta)}</p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">MTTR</p>
              <p className="text-2xl font-bold text-zinc-900 mt-2">{formatSeconds(mttr)}</p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">Auto-Resolved</p>
              <p className="text-2xl font-bold text-zinc-900 mt-2">{autoResolved.toFixed(1)}%</p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">Escalated</p>
              <p className="text-2xl font-bold text-zinc-900 mt-2">{escalated.toFixed(1)}%</p>
            </div>
          </div>

          {/* Top Noisiest Services */}
          {topNoisiest.length > 0 && (
            <>
              <p className="text-sm font-semibold text-zinc-700 mb-4 uppercase tracking-wide">
                Top {Math.min(topNoisiest.length, 10)} Noisiest Services
              </p>
              <table className="w-full border-collapse text-sm mb-8">
                <thead>
                  <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                    <th className="text-left p-3 font-semibold text-zinc-900">Service</th>
                    <th className="text-right p-3 font-semibold text-zinc-900">Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {topNoisiest.slice(0, 10).map((service: any, idx: number) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="p-3 text-zinc-900">{service.serviceName || `Service ${idx + 1}`}</td>
                      <td className="p-3 text-right text-zinc-900 font-mono">{(service.count || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Alert Sources */}
          {alertSources.length > 0 && (
            <>
              <p className="text-sm font-semibold text-zinc-700 mb-4 uppercase tracking-wide">
                Alert Sources
              </p>
              <table className="w-full border-collapse text-sm mb-8">
                <thead>
                  <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                    <th className="text-left p-3 font-semibold text-zinc-900">Source</th>
                    <th className="text-left p-3 font-semibold text-zinc-900">Type</th>
                    <th className="text-right p-3 font-semibold text-zinc-900">Incidents</th>
                    <th className="text-right p-3 font-semibold text-zinc-900">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {alertSources.map((source: any, idx: number) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="p-3 text-zinc-900">{source.sourceName || "Unknown"}</td>
                      <td className="p-3 text-zinc-600 capitalize">{source.integrationType || "unknown"}</td>
                      <td className="p-3 text-right text-zinc-900 font-mono">{(source.incidentCount || 0).toLocaleString()}</td>
                      <td className="p-3 text-right text-zinc-900 font-mono">{(source.percentOfTotal || 0).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4">
            <p className="text-sm text-zinc-900">
              Alert noise ratio:{" "}
              <span className="font-mono font-bold">
                {(noiseRatio * 100).toFixed(1)}%
              </span>
              {" | "}MTTA: <span className="font-mono font-bold">{formatSeconds(mtta)}</span>
              {" | "}MTTR: <span className="font-mono font-bold">{formatSeconds(mttr)}</span>
            </p>
            <p className="text-xs text-zinc-600 mt-2">
              {noiseRatio > 0.3
                ? "High noise levels indicate that incident.io's alert routing, deduplication, and auto-close rules can significantly reduce alert fatigue."
                : autoResolved > 20
                  ? `${autoResolved.toFixed(0)}% of incidents auto-resolve, suggesting transient alerts that incident.io's alert grouping can consolidate.`
                  : "Noise levels are acceptable — incident.io's native alert routing will maintain signal quality."}
            </p>
          </div>
        </div>

        {/* Configuration Inventory */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Configuration Inventory
          </h2>

          <table className="w-full border-collapse text-sm mb-8">
            <thead>
              <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                <th className="text-left p-3 font-semibold text-zinc-900">Resource Type</th>
                <th className="text-right p-3 font-semibold text-zinc-900">Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(resourcesByType).map(([type, count]) => (
                <tr key={type} className="border-b border-zinc-200">
                  <td className="p-3 text-zinc-900">{type}</td>
                  <td className="p-3 text-right text-zinc-900 font-mono">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-xs font-semibold text-green-900 uppercase">Auto-Convert</p>
              <p className="text-2xl font-bold text-green-900 mt-2">{autoConversions}</p>
            </div>
            <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
              <p className="text-xs font-semibold text-amber-900 uppercase">Manual</p>
              <p className="text-2xl font-bold text-amber-900 mt-2">{manualConversions}</p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-900 uppercase">Skip</p>
              <p className="text-2xl font-bold text-zinc-900 mt-2">{skipConversions}</p>
            </div>
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <p className="text-xs font-semibold text-red-900 uppercase">Unsupported</p>
              <p className="text-2xl font-bold text-red-900 mt-2">{unsupportedResources}</p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-xs font-semibold text-blue-900 uppercase">Total</p>
              <p className="text-2xl font-bold text-blue-900 mt-2">{totalMappings}</p>
            </div>
          </div>
        </div>

        {/* Tool Stack Detection */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Tool Stack Detection
          </h2>

          {shadowSignals.length > 0 ? (
            <>
              <div className={`rounded-lg p-6 mb-6 ${
                maintenanceBurden === "high"
                  ? "bg-red-50 border border-red-200"
                  : maintenanceBurden === "medium"
                    ? "bg-orange-50 border border-orange-200"
                    : "bg-green-50 border border-green-200"
              }`}>
                <p className="text-sm font-semibold mb-2">
                  Maintenance Burden: <span className="uppercase">{maintenanceBurden}</span>
                </p>
                <p className="text-sm">
                  {shadowStack?.maintenanceNarrative || "Tool stack analysis complete."}
                </p>
              </div>

              <table className="w-full border-collapse text-sm mb-8">
                <thead>
                  <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                    <th className="text-left p-3 font-semibold text-zinc-900">Signal Type</th>
                    <th className="text-left p-3 font-semibold text-zinc-900">Service</th>
                    <th className="text-left p-3 font-semibold text-zinc-900">Description</th>
                    <th className="text-center p-3 font-semibold text-zinc-900">Confidence</th>
                    <th className="text-left p-3 font-semibold text-zinc-900">incident.io Replacement</th>
                  </tr>
                </thead>
                <tbody>
                  {shadowSignals.map((signal: any, idx: number) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="p-3 text-zinc-900 text-xs font-mono">{signal.type}</td>
                      <td className="p-3 text-zinc-700">{signal.serviceName || "Global"}</td>
                      <td className="p-3 text-zinc-700">{signal.description}</td>
                      <td className="p-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          signal.confidence === "high"
                            ? "bg-red-100 text-red-800"
                            : signal.confidence === "medium"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-blue-100 text-blue-800"
                        }`}>
                          {signal.confidence}
                        </span>
                      </td>
                      <td className="p-3 text-zinc-700">
                        {signal.incidentIoReplacement ? (
                          <span>
                            <span className="font-medium">{signal.incidentIoReplacement.feature}</span>
                            <span className="text-xs text-zinc-500 block">{signal.incidentIoReplacement.effort}</span>
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Tool Stack TCO */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
                <p className="text-sm font-semibold text-purple-900 mb-2">Tool Stack TCO Impact</p>
                <p className="text-sm text-purple-800">
                  Eliminating <strong>{shadowSignals.length}</strong> custom integration
                  {shadowSignals.length !== 1 ? "s" : ""} and automation pattern
                  {shadowSignals.length !== 1 ? "s" : ""} reduces maintenance burden from{" "}
                  <strong>{maintenanceBurden}</strong> to near-zero by replacing custom tooling with native incident.io features:{" "}
                  {[...new Set(shadowSignals.map((s: any) => s.incidentIoReplacement?.feature).filter(Boolean))].join(", ") || "native platform capabilities"}.
                </p>
              </div>
            </>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <p className="text-sm text-green-800">
                No significant tool stack dependencies detected. The PagerDuty configuration relies primarily on native features, simplifying migration.
              </p>
            </div>
          )}
        </div>

        {/* Team-Based Migration Plan */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Migration Plan
          </h2>

          {/* Timeline summary */}
          {timeline.totalWeeks && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
              <p className="text-sm font-semibold text-blue-900 mb-2">Migration Timeline</p>
              <p className="text-2xl font-bold text-blue-900">
                {timeline.totalWeeks} weeks
                {timeline.totalEffortDays ? ` (${timeline.totalEffortDays} person-days)` : ""}
              </p>
              {timeline.complexityRating && (
                <p className="text-sm text-blue-800 mt-1">
                  Complexity: <span className="capitalize font-medium">{timeline.complexityRating}</span>
                </p>
              )}
            </div>
          )}

          {/* Team breakdown */}
          {teams.length > 0 && (
            <>
              <p className="text-sm font-semibold text-zinc-700 mb-4 uppercase tracking-wide">
                Team Breakdown
              </p>
              <table className="w-full border-collapse text-sm mb-8">
                <thead>
                  <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                    <th className="text-left p-3 font-semibold text-zinc-900">Team</th>
                    <th className="text-center p-3 font-semibold text-zinc-900">Services</th>
                    <th className="text-center p-3 font-semibold text-zinc-900">Incidents</th>
                    <th className="text-center p-3 font-semibold text-zinc-900">Risk</th>
                    <th className="text-center p-3 font-semibold text-zinc-900">Wave</th>
                    <th className="text-center p-3 font-semibold text-zinc-900">Effort (days)</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team: any, idx: number) => (
                    <tr key={idx} className="border-b border-zinc-200">
                      <td className="p-3 text-zinc-900 font-medium">{team.teamName}</td>
                      <td className="p-3 text-center text-zinc-900 font-mono">{team.serviceCount}</td>
                      <td className="p-3 text-center text-zinc-900 font-mono">{(team.incidentVolume || 0).toLocaleString()}</td>
                      <td className="p-3 text-center">
                        <span className={`font-mono font-bold ${
                          (team.riskScore || 0) <= 3 ? "text-green-700" :
                          (team.riskScore || 0) <= 6 ? "text-yellow-700" :
                          "text-red-700"
                        }`}>
                          {team.riskScore || 0}/10
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          team.recommendedWave === 1 ? "bg-green-100 text-green-800" :
                          team.recommendedWave === 2 ? "bg-yellow-100 text-yellow-800" :
                          "bg-red-100 text-red-800"
                        }`}>
                          Wave {team.recommendedWave || 1}
                        </span>
                      </td>
                      <td className="p-3 text-center text-zinc-900 font-mono">{team.effortDays || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Phased plan */}
          <div className="space-y-6">
            {phases.length > 0 ? (
              phases.map((phase: any) => (
                <div key={phase.number} className="border border-zinc-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="font-bold text-blue-900">{phase.number}</span>
                    </div>
                    <div className="flex-grow">
                      <h3 className="font-bold text-zinc-900 mb-1">{phase.title}</h3>
                      {phase.weekRange && (
                        <p className="text-xs text-zinc-500 mb-2">{phase.weekRange}</p>
                      )}
                      <p className="text-sm text-zinc-700 mb-3">{phase.description}</p>
                      {phase.tasks && phase.tasks.length > 0 && (
                        <ul className="text-sm text-zinc-700 space-y-1 ml-4 list-disc">
                          {phase.tasks.map((task: string, idx: number) => (
                            <li key={idx}>{task}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              /* Fallback generic phases when no project plan */
              <>
                <div className="border border-zinc-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="font-bold text-blue-900">1</span>
                    </div>
                    <div className="flex-grow">
                      <h3 className="font-bold text-zinc-900 mb-2">Phase 1: Discovery & Foundation</h3>
                      <ul className="text-sm text-zinc-700 space-y-1 ml-4 list-disc">
                        <li>Complete resource inventory and conversion planning</li>
                        <li>Set up incident.io tenant and SSO integration</li>
                        <li>Document all custom workflows and tool stack dependencies</li>
                        <li>Select pilot team for 14-day POV</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="border border-zinc-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="font-bold text-blue-900">2</span>
                    </div>
                    <div className="flex-grow">
                      <h3 className="font-bold text-zinc-900 mb-2">Phase 2: On-Call Migration</h3>
                      <ul className="text-sm text-zinc-700 space-y-1 ml-4 list-disc">
                        <li>Import schedules and escalation policies</li>
                        <li>Configure alert routing and integration endpoints</li>
                        <li>Run parallel monitoring with PagerDuty</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="border border-zinc-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="font-bold text-blue-900">3</span>
                    </div>
                    <div className="flex-grow">
                      <h3 className="font-bold text-zinc-900 mb-2">Phase 3: Workflow & Tool Stack</h3>
                      <ul className="text-sm text-zinc-700 space-y-1 ml-4 list-disc">
                        <li>Replace custom automation with incident.io native features</li>
                        <li>Migrate webhook destinations and API consumers</li>
                        <li>Configure incident workflows and status pages</li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="border border-zinc-200 rounded-lg p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="font-bold text-blue-900">4</span>
                    </div>
                    <div className="flex-grow">
                      <h3 className="font-bold text-zinc-900 mb-2">Phase 4: Cutover & Decommission</h3>
                      <ul className="text-sm text-zinc-700 space-y-1 ml-4 list-disc">
                        <li>Complete migration of remaining services</li>
                        <li>Decommission PagerDuty (contract negotiation)</li>
                        <li>Validation, tuning, and team training</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Value Proposition */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Value Proposition
          </h2>

          <div className="space-y-4">
            <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
              <p className="font-semibold text-green-900">Platform Consolidation</p>
              <p className="text-sm text-green-800 mt-1">
                Replace PagerDuty + {shadowSignals.length > 0 ? `${shadowSignals.length} custom integration${shadowSignals.length !== 1 ? "s" : ""}` : "separate tools"} with
                a single incident.io platform — on-call, alerts, incidents, status pages, and workflows in one place.
              </p>
            </div>

            {noiseRatio > 0.2 && (
              <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
                <p className="font-semibold text-green-900">Alert Quality Improvement</p>
                <p className="text-sm text-green-800 mt-1">
                  Current {(noiseRatio * 100).toFixed(0)}% noise ratio can be significantly reduced with incident.io&apos;s
                  native alert routing, deduplication, and auto-close rules — reducing alert fatigue for on-call engineers.
                </p>
              </div>
            )}

            {shadowSignals.length > 0 && (
              <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
                <p className="font-semibold text-green-900">Tool Stack Elimination</p>
                <p className="text-sm text-green-800 mt-1">
                  {shadowSignals.length} custom automation pattern{shadowSignals.length !== 1 ? "s" : ""} can be replaced
                  with native incident.io features:{" "}
                  {[...new Set(shadowSignals.map((s: any) => s.incidentIoReplacement?.feature).filter(Boolean))].slice(0, 5).join(", ") || "platform-native capabilities"}.
                  This eliminates {maintenanceBurden} ongoing maintenance burden.
                </p>
              </div>
            )}

            <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
              <p className="font-semibold text-green-900">Modern Incident Management</p>
              <p className="text-sm text-green-800 mt-1">
                incident.io provides native Slack-first incident management, automated post-mortems,
                catalog-driven service ownership, and workflow automation — capabilities that require
                custom tooling or third-party add-ons in PagerDuty.
              </p>
            </div>

            {pilots.length > 0 && (
              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                <p className="font-semibold text-blue-900">Recommended Next Step</p>
                <p className="text-sm text-blue-800 mt-1">
                  Start a 14-day Proof of Value with <strong>{pilots[0].teamName}</strong> to
                  validate incident.io&apos;s capabilities against real-world operational patterns.
                  {timeline.totalWeeks && ` Full migration estimated at ${timeline.totalWeeks} weeks.`}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="page-break py-8 border-t border-zinc-200 mt-12">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-zinc-600">
                Generated by PD Migration Analyzer
              </p>
              <p className="text-xs text-zinc-600 mt-1">
                {formatDate(new Date())}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-zinc-900 mb-2">
                Powered by
              </p>
              <p className="text-xs font-semibold text-amber-600">
                incident.io
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
