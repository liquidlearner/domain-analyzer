import { useState, useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Zap,
  Webhook,
  Bot,
  Code,
  ChevronDown,
  Route,
  FileCode,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ToolStackTabProps {
  evaluation: any;
  analysisData?: any;
}

const SIGNAL_ICONS: Record<string, React.ReactNode> = {
  api_consumer: <Code className="h-5 w-5 text-blue-500" />,
  webhook_destination: <Webhook className="h-5 w-5 text-purple-500" />,
  auto_ack: <Bot className="h-5 w-5 text-green-500" />,
  auto_resolve: <Bot className="h-5 w-5 text-emerald-500" />,
  api_created_incident: <Zap className="h-5 w-5 text-yellow-500" />,
  enrichment_middleware: <AlertCircle className="h-5 w-5 text-orange-500" />,
  eo_routing_layer: <Route className="h-5 w-5 text-red-500" />,
  terraform_consumer: <FileCode className="h-5 w-5 text-cyan-500" />,
  analytics_pipeline: <BarChart3 className="h-5 w-5 text-indigo-500" />,
  custom_extension: <Code className="h-5 w-5 text-pink-500" />,
};

const SIGNAL_LABELS: Record<string, string> = {
  api_consumer: "API Consumer",
  webhook_destination: "Webhook Destination",
  auto_ack: "Auto-Acknowledge",
  auto_resolve: "Auto-Resolve",
  api_created_incident: "API-Created Incident",
  enrichment_middleware: "Enrichment Middleware",
  eo_routing_layer: "Event Orchestration Routing",
  terraform_consumer: "Terraform/IaC",
  analytics_pipeline: "Analytics Pipeline",
  custom_extension: "Custom Extension",
};

export default function ToolStackTab({ evaluation, analysisData }: ToolStackTabProps) {
  const [expandedSignals, setExpandedSignals] = useState<Set<number>>(new Set());
  const shadowStack = analysisData?.shadowStack;

  const { signals, stats, dataLimitations } = useMemo(() => {
    const signals: any[] = shadowStack?.signals || [];
    const stats = {
      apiConsumers: shadowStack?.apiConsumerCount || 0,
      webhookDestinations: shadowStack?.webhookDestinationCount || 0,
      automationPatterns: shadowStack?.automationPatternCount || 0,
      eoRoutingLayers: shadowStack?.eoRoutingLayerCount || 0,
      totalSignals: signals.length,
    };
    const dataLimitations: string[] = shadowStack?.dataLimitations || [];
    return { signals, stats, dataLimitations };
  }, [shadowStack]);

  const toggleSignal = (index: number) => {
    const newSet = new Set(expandedSignals);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setExpandedSignals(newSet);
  };

  const getConfidenceBadgeColor = (confidence: string) => {
    switch (confidence) {
      case "high": return "bg-red-100 text-red-800";
      case "medium": return "bg-yellow-100 text-yellow-800";
      case "low": return "bg-blue-100 text-blue-800";
      default: return "bg-zinc-100 text-zinc-800";
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

  const burden = shadowStack?.estimatedMaintenanceBurden || "low";
  const narrative = shadowStack?.maintenanceNarrative || "No significant tool stack dependencies detected.";

  return (
    <div className="space-y-6">
      {/* Data Limitations Warning */}
      {dataLimitations.length > 0 && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Incomplete Detection</p>
                <ul className="text-xs text-amber-700 mt-1 space-y-1">
                  {dataLimitations.map((limitation: string, idx: number) => (
                    <li key={idx}>{limitation}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">API Consumers</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{stats.apiConsumers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Webhook Destinations</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{stats.webhookDestinations}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Automation Patterns</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{stats.automationPatterns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">EO Routing Layers</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{stats.eoRoutingLayers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Total Signals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{stats.totalSignals}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tool Stack Signal Cards */}
      {signals.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-zinc-500">No tool stack signals detected for the selected scope.{dataLimitations.length > 0 ? " This may be due to incomplete data — see warnings above." : ""}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {signals.map((signal: any, idx: number) => (
            <Card key={idx} className="cursor-pointer hover:shadow-md transition-shadow">
              <button
                onClick={() => toggleSignal(idx)}
                className="w-full text-left p-4 flex items-start justify-between"
              >
                <div className="flex items-start gap-4 flex-1">
                  <div className="mt-1">{SIGNAL_ICONS[signal.type] || <Code className="h-5 w-5 text-zinc-400" />}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-semibold text-sm text-zinc-900">{signal.description}</p>
                      <Badge className={getConfidenceBadgeColor(signal.confidence)}>
                        {signal.confidence}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {SIGNAL_LABELS[signal.type] || signal.type}
                      </Badge>
                      {signal.count > 1 && (
                        <Badge variant="outline" className="text-xs">{signal.count}x</Badge>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">
                      Service: {signal.serviceName || "Global"}
                    </p>
                  </div>
                </div>
                <ChevronDown className={`h-5 w-5 text-zinc-400 transition-transform flex-shrink-0 ${expandedSignals.has(idx) ? "rotate-180" : ""}`} />
              </button>

              {expandedSignals.has(idx) && (
                <div className="px-4 pb-4 border-t border-zinc-200 pt-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-zinc-600 mb-1">Evidence:</p>
                    <p className="text-sm text-zinc-700 bg-zinc-50 rounded p-2">{signal.evidence}</p>
                  </div>
                  {signal.incidentIoReplacement && (
                    <div className="bg-green-50 border border-green-200 rounded p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <ArrowRight className="h-4 w-4 text-green-600" />
                        <p className="text-xs font-semibold text-green-800">incident.io Replacement</p>
                      </div>
                      <p className="text-sm font-medium text-green-900">{signal.incidentIoReplacement.feature}</p>
                      <p className="text-xs text-green-800 mt-1">{signal.incidentIoReplacement.action}</p>
                      <p className="text-xs text-green-700 mt-1">Effort: {signal.incidentIoReplacement.effort}</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Maintenance Burden Summary */}
      <Card className={`${burden === "high" ? "bg-red-50 border-red-200" : burden === "medium" ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"}`}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className={`h-5 w-5 ${burden === "high" ? "text-red-600" : burden === "medium" ? "text-orange-600" : "text-green-600"}`} />
            Tool Stack Maintenance Burden: <span className="uppercase">{burden}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-sm ${burden === "high" ? "text-red-900" : burden === "medium" ? "text-orange-900" : "text-green-900"}`}>
            {narrative}
          </p>
          {signals.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-zinc-700 mb-2">incident.io features that replace this tool stack:</p>
              <div className="flex flex-wrap gap-2">
                {[...new Set(signals.map((s: any) => s.incidentIoReplacement?.feature).filter(Boolean))].map((feature: any, idx: number) => (
                  <Badge key={idx} className="bg-primary-light text-primary border-primary-muted">{feature}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
