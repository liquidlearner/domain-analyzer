import { useState, useMemo } from "react";
import { ChevronDown, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface MigrationMapping {
  conversionStatus: "AUTO" | "MANUAL" | "SKIP" | "UNSUPPORTED";
  effortEstimate?: string | null;
  pdResource: {
    pdType: string;
    name: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Evaluation = any;

interface MigrationPlanTabProps {
  evaluation: Evaluation;
}

interface Phase {
  number: number;
  title: string;
  description: string;
  expanded: boolean;
  resources: MigrationMapping[];
  effort?: string;
}

export default function MigrationPlanTab({ evaluation }: MigrationPlanTabProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([1]));

  const { phases, riskFactors, timelineEstimate } = useMemo(() => {
    const mappings: MigrationMapping[] = evaluation.migrationMappings || [];

    const autoResources = mappings.filter((m) => m.conversionStatus === "AUTO");
    const manualResources = mappings.filter((m) => m.conversionStatus === "MANUAL");
    const skipResources = mappings.filter((m) => m.conversionStatus === "SKIP");

    // Calculate effort
    let autoEffort = 0;
    let manualEffort = 0;

    manualResources.forEach((r) => {
      const estimate = r.effortEstimate || "2d";
      if (estimate.includes("d")) {
        manualEffort += parseInt(estimate) * 8; // Convert days to hours
      } else if (estimate.includes("h")) {
        manualEffort += parseInt(estimate);
      }
    });

    const phases: Phase[] = [
      {
        number: 1,
        title: "Phase 1 — Auto-convert",
        description:
          "Automatically migrated resources that have direct incident.io equivalents",
        expanded: false,
        resources: autoResources,
        effort: "< 1 day (automated)",
      },
      {
        number: 2,
        title: "Phase 2 — Manual effort",
        description:
          "Resources requiring manual configuration and testing in incident.io",
        expanded: false,
        resources: manualResources,
        effort: `${Math.ceil(manualEffort / 8)} days (${manualEffort}h)`,
      },
      {
        number: 3,
        title: "Phase 3 — Skip & cleanup",
        description: "Deprecated resources and configurations not needed in incident.io",
        expanded: false,
        resources: skipResources,
        effort: "Documentation only",
      },
    ];

    const riskFactors = [
      "High custom automation complexity requiring shadow stack migration",
      "Multiple escalation policy levels may need restructuring",
      "Email integrations require validation for equivalent incident.io behavior",
      "Custom event routing rules need testing before cutover",
    ];

    const totalEffort = autoEffort + manualEffort;
    const estimatedDays = Math.ceil(totalEffort / 8) + 2; // Add 2 days for testing
    const timelineEstimate = `${estimatedDays}-${estimatedDays + 3} business days`;

    return { phases, riskFactors, timelineEstimate };
  }, [evaluation]);

  const togglePhase = (phaseNumber: number) => {
    const newSet = new Set(expandedPhases);
    if (newSet.has(phaseNumber)) {
      newSet.delete(phaseNumber);
    } else {
      newSet.add(phaseNumber);
    }
    setExpandedPhases(newSet);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "AUTO":
        return "bg-green-100 text-green-800";
      case "MANUAL":
        return "bg-yellow-100 text-yellow-800";
      case "SKIP":
        return "bg-zinc-100 text-zinc-800";
      case "UNSUPPORTED":
        return "bg-red-100 text-red-800";
      default:
        return "bg-zinc-100 text-zinc-800";
    }
  };

  return (
    <div className="space-y-6">
      {/* Timeline Estimate */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <Clock className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-blue-900">Estimated Timeline</p>
              <p className="text-2xl font-bold text-blue-900 mt-1">{timelineEstimate}</p>
              <p className="text-xs text-blue-800 mt-2">
                Includes resource conversion, testing, and parallel running period
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Phase Cards */}
      <div className="space-y-4">
        {phases.map((phase) => (
          <Card key={phase.number}>
            <button
              onClick={() => togglePhase(phase.number)}
              className="w-full text-left p-6 flex items-start justify-between hover:bg-zinc-50 transition-colors"
            >
              <div className="flex-1">
                <p className="font-semibold text-base text-zinc-900">{phase.title}</p>
                <p className="text-sm text-zinc-600 mt-1">{phase.description}</p>
                <div className="flex items-center gap-4 mt-3">
                  <Badge variant="secondary">
                    {phase.resources.length} resource{phase.resources.length !== 1 ? "s" : ""}
                  </Badge>
                  <span className="text-xs text-zinc-500">{phase.effort}</span>
                </div>
              </div>
              <ChevronDown
                className={`h-5 w-5 text-zinc-400 transition-transform flex-shrink-0 mt-1 ${
                  expandedPhases.has(phase.number) ? "rotate-180" : ""
                }`}
              />
            </button>

            {expandedPhases.has(phase.number) && phase.resources.length > 0 && (
              <div className="border-t border-zinc-200 p-6 space-y-3">
                {phase.resources.map((resource, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between p-3 bg-zinc-50 rounded"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm text-zinc-900">
                        {resource.pdResource.name}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Type: {resource.pdResource.pdType}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                      <Badge className={getStatusColor(resource.conversionStatus)}>
                        {resource.conversionStatus}
                      </Badge>
                      {resource.effortEstimate && (
                        <span className="text-xs text-zinc-600">{resource.effortEstimate}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Risk Factors */}
      <Card className="border-orange-200 bg-orange-50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-600" />
            Migration Risk Factors
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {riskFactors.map((factor, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-orange-600 flex-shrink-0 mt-2" />
                <p className="text-sm text-orange-900">{factor}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Recommended Approach */}
      <Card className="bg-green-50 border-green-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Recommended Migration Approach
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold text-sm text-green-900 mb-2">1. Pre-migration Phase</h4>
            <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
              <li>Document all custom API integrations and webhook destinations</li>
              <li>Audit alert routing rules and escalation policies</li>
              <li>Identify critical services that need priority migration</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-green-900 mb-2">2. Parallel Running</h4>
            <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
              <li>Run PagerDuty and incident.io side-by-side for 1-2 weeks</li>
              <li>Gradually shift traffic to incident.io after validation</li>
              <li>Monitor incident quality metrics on both platforms</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-green-900 mb-2">3. Cutover Strategy</h4>
            <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
              <li>Start with low-critical services and escalate to high-critical</li>
              <li>Maintain PagerDuty in read-only mode during transition</li>
              <li>Have rollback plan ready for first 48 hours</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}