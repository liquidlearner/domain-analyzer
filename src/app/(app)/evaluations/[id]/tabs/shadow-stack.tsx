import { useState, useMemo } from "react";
import {
  AlertCircle,
  Zap,
  Webhook,
  Bot,
  Code,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ShadowSignal {
  type: string;
  confidence: "high" | "medium" | "low";
  description: string;
  evidence: string;
  serviceName?: string;
}

interface Evaluation {
  id: string;
}

interface ShadowStackTabProps {
  evaluation: Evaluation;
}

interface Signal {
  type: string;
  confidence: "high" | "medium" | "low";
  description: string;
  evidence: string;
  serviceName?: string;
  icon: React.ReactNode;
}

export default function ShadowStackTab({ evaluation }: ShadowStackTabProps) {
  const [expandedSignals, setExpandedSignals] = useState<Set<number>>(new Set());

  const { signals, stats } = useMemo(() => {
    // Simulated shadow stack signals
    const signals: Signal[] = [
      {
        type: "api_consumer",
        confidence: "high",
        description: "Datadog API integration detected on Auth Service",
        evidence: "API token detected in log entries during last 90 days",
        serviceName: "Auth Service",
        icon: <Code className="h-5 w-5 text-blue-500" />,
      },
      {
        type: "webhook_destination",
        confidence: "high",
        description: "Outbound webhook to Slack on Payment Processor",
        evidence: "Webhook integration configured for transaction alerts",
        serviceName: "Payment Processor",
        icon: <Webhook className="h-5 w-5 text-purple-500" />,
      },
      {
        type: "auto_ack",
        confidence: "high",
        description: "Auto-responder pattern on API Gateway",
        evidence: "Incidents acknowledged within 5-10 seconds automatically",
        serviceName: "API Gateway",
        icon: <Bot className="h-5 w-5 text-green-500" />,
      },
      {
        type: "api_created_incident",
        confidence: "medium",
        description: "Custom incident creation on Cache Layer",
        evidence: "Service-triggered incidents detected via API",
        serviceName: "Cache Layer",
        icon: <Zap className="h-5 w-5 text-yellow-500" />,
      },
      {
        type: "enrichment_middleware",
        confidence: "high",
        description: "Enrichment pipeline on Queue Worker",
        evidence: "Incident notes added automatically via API enrichment",
        serviceName: "Queue Worker",
        icon: <AlertCircle className="h-5 w-5 text-orange-500" />,
      },
      {
        type: "webhook_destination",
        confidence: "medium",
        description: "Custom webhook integration on Search Index",
        evidence: "Outbound webhook configured for log aggregation",
        serviceName: "Search Index",
        icon: <Webhook className="h-5 w-5 text-purple-500" />,
      },
    ];

    const stats = {
      apiConsumers: signals.filter((s) => s.type === "api_consumer").length,
      webhookDestinations: signals.filter((s) => s.type === "webhook_destination").length,
      automationPatterns: signals.filter((s) => s.type === "auto_ack").length,
      totalSignals: signals.length,
    };

    return { signals, stats };
  }, []);

  const toggleSignal = (index: number) => {
    const newSet = new Set(expandedSignals);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedSignals(newSet);
  };

  const getConfidenceBadgeColor = (
    confidence: "high" | "medium" | "low"
  ) => {
    switch (confidence) {
      case "high":
        return "bg-red-100 text-red-800";
      case "medium":
        return "bg-yellow-100 text-yellow-800";
      case "low":
        return "bg-blue-100 text-blue-800";
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
            <CardTitle className="text-xs font-medium text-zinc-600">Total Signals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-zinc-900">{stats.totalSignals}</p>
          </CardContent>
        </Card>
      </div>

      {/* Shadow Signals Cards */}
      <div className="space-y-3">
        {signals.map((signal, idx) => (
          <Card key={idx} className="cursor-pointer hover:shadow-md transition-shadow">
            <button
              onClick={() => toggleSignal(idx)}
              className="w-full text-left p-4 flex items-start justify-between"
            >
              <div className="flex items-start gap-4 flex-1">
                <div className="mt-1">{signal.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-sm text-zinc-900">
                      {signal.description}
                    </p>
                    <Badge className={getConfidenceBadgeColor(signal.confidence)}>
                      {signal.confidence.charAt(0).toUpperCase() + signal.confidence.slice(1)}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Service: {signal.serviceName || "Unknown"}
                  </p>
                </div>
              </div>
              <ChevronDown
                className={`h-5 w-5 text-zinc-400 transition-transform flex-shrink-0 ${
                  expandedSignals.has(idx) ? "rotate-180" : ""
                }`}
              />
            </button>

            {expandedSignals.has(idx) && (
              <div className="px-4 pb-4 border-t border-zinc-200 pt-4">
                <div>
                  <p className="text-xs font-semibold text-zinc-600 mb-2">Evidence:</p>
                  <p className="text-sm text-zinc-700 bg-zinc-50 rounded p-2">
                    {signal.evidence}
                  </p>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Summary Card */}
      <Card className="bg-orange-50 border-orange-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-600" />
            Shadow Stack Maintenance Burden
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-orange-900 mb-4">
            This PagerDuty instance has a <span className="font-semibold">MEDIUM</span> shadow stack
            complexity, indicating moderate customization and dependency management during migration.
          </p>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-orange-800 mb-1">
                Key Dependencies to Migrate:
              </p>
              <ul className="text-xs text-orange-700 space-y-1 list-disc list-inside">
                <li>API integrations need to be reconfigured with incident.io API</li>
                <li>Webhook destinations must be updated with new incident.io endpoints</li>
                <li>Auto-responder logic may need adjustment for incident.io behavior</li>
                <li>Enrichment pipelines require testing in new environment</li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold text-orange-800 mb-1">
                Recommended Actions:
              </p>
              <ul className="text-xs text-orange-700 space-y-1 list-disc list-inside">
                <li>Document all custom API consumers before migration</li>
                <li>Test webhook payload compatibility with incident.io</li>
                <li>Plan staged rollout of automation integrations</li>
                <li>Establish parallel running period for critical automations</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}