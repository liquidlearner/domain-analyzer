import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import { prisma } from "@/server/db/client";
import { formatDate } from "@/lib/utils";

interface ReportPageProps {
  params: {
    id: string;
  };
}

export default async function ReportPage({ params }: ReportPageProps) {
  const evaluation = await prisma.evaluation.findUnique({
    where: { id: params.id },
    include: {
      domain: {
        include: {
          customer: true,
        },
      },
      createdBy: true,
      configSnapshot: {
        include: {
          resources: true,
        },
      },
      incidentAnalyses: {
        orderBy: { periodStart: "desc" },
      },
      migrationMappings: {
        include: {
          pdResource: true,
        },
      },
    },
  });

  if (!evaluation) {
    notFound();
  }

  const customer = evaluation.domain.customer;
  const configResources = evaluation.configSnapshot?.resources || [];
  const incidentData = evaluation.incidentAnalyses[0];

  // Calculate statistics
  const totalServices = configResources.filter(
    (r: any) => r.resourceType === "SERVICE"
  ).length;
  const autoConversions = evaluation.migrationMappings.filter(
    (m: any) => m.conversionStatus === "AUTO"
  ).length;
  const manualConversions = evaluation.migrationMappings.filter(
    (m: any) => m.conversionStatus === "MANUAL"
  ).length;
  const unsupportedResources = evaluation.migrationMappings.filter(
    (m: any) => m.conversionStatus === "UNSUPPORTED"
  ).length;

  // Group resources by type
  const resourcesByType: Record<string, number> = {};
  configResources.forEach((r: any) => {
    resourcesByType[r.resourceType] = (resourcesByType[r.resourceType] || 0) + 1;
  });

  // Calculate noise ratio
  const noiseRatio = incidentData?.noiseRatio || 0;
  const complexityRating = noiseRatio > 0.3 ? "High" : "Medium";

  // Top services by volume
  const topServices =
    evaluation.incidentAnalyses
      .filter((a: any) => a.serviceId)
      .sort((a: any, b: any) => b.incidentCount - a.incidentCount)
      .slice(0, 10) || [];

  // Migration effort
  const totalMappings = evaluation.migrationMappings.length;
  const conversionRate = totalMappings > 0 ? 
    Math.round(((autoConversions + manualConversions) / totalMappings) * 100) : 0;

  return (
    <div className="relative">
      {/* Screen-only controls */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-zinc-200 p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href={`/evaluations/${params.id}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Evaluation
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.print();
              }
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
        </div>
      </div>

      {/* Report Content */}
      <div className="max-w-6xl mx-auto p-8 bg-white">
        {/* Header Section */}
        <div className="page-break pb-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-zinc-900 mb-2">
              PagerDuty Migration Assessment
            </h1>
            <p className="text-lg text-zinc-600">
              Comprehensive technical evaluation and migration roadmap
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
                {evaluation.domain.domain}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-600 uppercase tracking-wide">
                Report Date
              </p>
              <p className="text-lg text-zinc-900 mt-1">
                {formatDate(new Date())}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-600 uppercase tracking-wide">
                Evaluation Status
              </p>
              <p className="text-lg text-zinc-900 mt-1 font-mono">
                {evaluation.status}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold text-zinc-600 uppercase tracking-wide mb-2">
              Scope
            </p>
            <p className="text-zinc-900">
              {evaluation.scopeType === "SERVICE" ? "Services" : "Teams"}: {evaluation.scopeIds.length} resource
              {evaluation.scopeIds.length !== 1 ? "s" : ""}
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
                Total Services
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-2">
                {totalServices}
              </p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">
                Incident Count (30d)
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-2">
                {incidentData?.incidentCount || 0}
              </p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">
                Noise Ratio
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-2">
                {(noiseRatio * 100).toFixed(1)}%
              </p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 uppercase">
                Complexity
              </p>
              <p className="text-3xl font-bold text-zinc-900 mt-2">
                {complexityRating}
              </p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <p className="text-sm text-blue-900 font-semibold mb-2">
              Migration Readiness
            </p>
            <p className="text-blue-800">
              This organization has {conversionRate}% of resources that can be
              automatically or manually converted to incident.io equivalents.{" "}
              {complexityRating === "High"
                ? "The high alert noise level suggests significant tuning opportunities."
                : "Alert patterns are relatively stable and well-tuned."}
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
                <th className="text-left p-3 font-semibold text-zinc-900">
                  Resource Type
                </th>
                <th className="text-right p-3 font-semibold text-zinc-900">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(resourcesByType).map(([type, count]) => (
                <tr key={type} className="border-b border-zinc-200">
                  <td className="p-3 text-zinc-900">{type}</td>
                  <td className="p-3 text-right text-zinc-900 font-mono">
                    {count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-xs font-semibold text-green-900 uppercase">
                Auto-Conversion
              </p>
              <p className="text-2xl font-bold text-green-900 mt-2">
                {autoConversions}
              </p>
            </div>
            <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
              <p className="text-xs font-semibold text-amber-900 uppercase">
                Manual Conversion
              </p>
              <p className="text-2xl font-bold text-amber-900 mt-2">
                {manualConversions}
              </p>
            </div>
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <p className="text-xs font-semibold text-red-900 uppercase">
                Unsupported
              </p>
              <p className="text-2xl font-bold text-red-900 mt-2">
                {unsupportedResources}
              </p>
            </div>
            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-900 uppercase">
                Total
              </p>
              <p className="text-2xl font-bold text-zinc-900 mt-2">
                {totalMappings}
              </p>
            </div>
          </div>
        </div>

        {/* Operational Reality */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Operational Reality
          </h2>

          <p className="text-sm font-semibold text-zinc-700 mb-4 uppercase tracking-wide">
            Top 10 Services by Incident Volume (30 days)
          </p>

          <table className="w-full border-collapse text-sm mb-8">
            <thead>
              <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                <th className="text-left p-3 font-semibold text-zinc-900">
                  Service
                </th>
                <th className="text-right p-3 font-semibold text-zinc-900">
                  Incidents
                </th>
                <th className="text-right p-3 font-semibold text-zinc-900">
                  Alerts
                </th>
              </tr>
            </thead>
            <tbody>
              {topServices.length > 0 ? (
                topServices.map((service: any, idx: any) => (
                  <tr key={idx} className="border-b border-zinc-200">
                    <td className="p-3 text-zinc-900">
                      Service {idx + 1}
                    </td>
                    <td className="p-3 text-right text-zinc-900 font-mono">
                      {service.incidentCount}
                    </td>
                    <td className="p-3 text-right text-zinc-900 font-mono">
                      {service.alertCount}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="p-3 text-center text-zinc-500">
                    No incident data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="text-sm font-semibold text-zinc-700 mb-4 uppercase tracking-wide">
            Noise Analysis
          </p>

          <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4">
            <p className="text-sm text-zinc-900">
              Alert noise ratio: <span className="font-mono font-bold">{(noiseRatio * 100).toFixed(2)}%</span>
            </p>
            <p className="text-xs text-zinc-600 mt-2">
              {noiseRatio > 0.3
                ? "High noise levels indicate that tuning alert thresholds and rules should be a priority during migration."
                : "Noise levels are acceptable, suggesting well-tuned alerting practices."}
            </p>
          </div>
        </div>

        {/* Shadow Stack Detection */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Shadow Stack Detection
          </h2>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
            <p className="text-sm font-semibold text-purple-900 mb-2">
              Detected Signals
            </p>
            <p className="text-sm text-purple-800">
              Analysis of incident patterns has identified external automation and
              integration touchpoints that may exist outside primary PagerDuty
              configuration. These "shadow stack" components should be inventoried
              and integrated into the migration plan.
            </p>
          </div>
        </div>

        {/* Migration Plan */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Migration Plan
          </h2>

          <div className="space-y-6">
            {/* Phase 1 */}
            <div className="border border-zinc-200 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="font-bold text-blue-900">1</span>
                </div>
                <div className="flex-grow">
                  <h3 className="font-bold text-zinc-900 mb-2">
                    Phase 1: Assessment & Pilot (Weeks 1-4)
                  </h3>
                  <ul className="text-sm text-zinc-700 space-y-1 ml-4 list-disc">
                    <li>Complete resource inventory and conversion planning</li>
                    <li>Set up incident.io tenant and SSO integration</li>
                    <li>Pilot with 1-2 low-risk services</li>
                    <li>Document any custom workflows or automations</li>
                  </ul>
                  <p className="text-sm font-semibold text-zinc-600 mt-3">
                    Effort: {autoConversions > 50 ? "10" : "8"} person-days
                  </p>
                </div>
              </div>
            </div>

            {/* Phase 2 */}
            <div className="border border-zinc-200 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="font-bold text-blue-900">2</span>
                </div>
                <div className="flex-grow">
                  <h3 className="font-bold text-zinc-900 mb-2">
                    Phase 2: Core Migration (Weeks 5-12)
                  </h3>
                  <ul className="text-sm text-zinc-700 space-y-1 ml-4 list-disc">
                    <li>
                      Migrate {Math.round(totalServices * 0.5)}-{Math.round(totalServices * 0.7)} services
                    </li>
                    <li>Implement custom alert routing and escalation rules</li>
                    <li>Configure automation and integration touchpoints</li>
                    <li>Run parallel monitoring with PagerDuty</li>
                  </ul>
                  <p className="text-sm font-semibold text-zinc-600 mt-3">
                    Effort: {autoConversions > 50 ? "30" : "25"} person-days
                  </p>
                </div>
              </div>
            </div>

            {/* Phase 3 */}
            <div className="border border-zinc-200 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="font-bold text-blue-900">3</span>
                </div>
                <div className="flex-grow">
                  <h3 className="font-bold text-zinc-900 mb-2">
                    Phase 3: Cutover & Validation (Weeks 13-16)
                  </h3>
                  <ul className="text-sm text-zinc-700 space-y-1 ml-4 list-disc">
                    <li>Complete migration of remaining services</li>
                    <li>Decommission PagerDuty (contract negotiation)</li>
                    <li>Validation and tuning phase</li>
                    <li>Team training and documentation</li>
                  </ul>
                  <p className="text-sm font-semibold text-zinc-600 mt-3">
                    Effort: {autoConversions > 50 ? "15" : "12"} person-days
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-zinc-50 border border-zinc-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-zinc-900 mb-2">
              Total Estimated Timeline: 16 weeks (4 months)
            </p>
            <p className="text-sm text-zinc-700">
              Total Effort: {autoConversions > 50 ? "55" : "45"} person-days
            </p>
          </div>
        </div>

        {/* Recommendations */}
        <div className="page-break py-8">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">
            Recommendations
          </h2>

          <div className="space-y-4">
            <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
              <p className="font-semibold text-green-900">
                ✓ Begin with low-risk services
              </p>
              <p className="text-sm text-green-800 mt-1">
                Prioritize migration of services with lower incident volume to
                build confidence and refine processes.
              </p>
            </div>

            <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
              <p className="font-semibold text-green-900">
                ✓ Document all integrations
              </p>
              <p className="text-sm text-green-800 mt-1">
                Audit and catalog all external systems that interact with
                PagerDuty to ensure full migration coverage.
              </p>
            </div>

            {complexityRating === "High" && (
              <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded">
                <p className="font-semibold text-amber-900">
                  ! Alert noise tuning
                </p>
                <p className="text-sm text-amber-800 mt-1">
                  High alert noise levels present an opportunity to improve
                  alerting quality during migration.
                </p>
              </div>
            )}

            <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
              <p className="font-semibold text-green-900">
                ✓ Plan team communication
              </p>
              <p className="text-sm text-green-800 mt-1">
                Ensure on-call engineers are trained on incident.io before
                cutover and have clear escalation paths.
              </p>
            </div>
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
