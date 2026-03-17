import { useState, useMemo } from "react";
import {
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Clock,
  Users,
  Star,
  Shield,
  ArrowRight,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface MigrationPlanTabProps {
  evaluation: any;
  analysisData?: any;
}

export default function MigrationPlanTab({ evaluation, analysisData }: MigrationPlanTabProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([1]));
  const projectPlan = analysisData?.projectPlan;

  const {
    pilots,
    teams,
    phases,
    roadmapItems,
    timeline,
    mappingBreakdown,
    riskFactors,
  } = useMemo(() => {
    const pilots: any[] = projectPlan?.pilotRecommendations || [];
    const teams: any[] = projectPlan?.teams || [];
    const phases: any[] = projectPlan?.phases || [];
    const roadmapItems: any[] = projectPlan?.shadowStackRoadmap || [];
    const timeline = projectPlan?.overallTimeline || {};

    // Migration mapping breakdown (fallback if no project plan)
    const mappings = evaluation.migrationMappings || [];
    const mappingBreakdown = {
      auto: mappings.filter((m: any) => m.conversionStatus === "AUTO"),
      manual: mappings.filter((m: any) => m.conversionStatus === "MANUAL"),
      skip: mappings.filter((m: any) => m.conversionStatus === "SKIP"),
      total: mappings.length,
    };

    // Dynamic risk factors from analysis
    const riskFactors: string[] = [];
    const shadowStack = analysisData?.shadowStack;
    if (shadowStack?.signals?.length > 5) {
      riskFactors.push(`${shadowStack.signals.length} tool stack signals indicate significant custom automation requiring parallel migration`);
    }
    if (shadowStack?.estimatedMaintenanceBurden === "high") {
      riskFactors.push("High tool stack maintenance burden — plan for dedicated engineering time to replace custom integrations");
    }
    if (mappingBreakdown.manual.length > mappingBreakdown.auto.length) {
      riskFactors.push(`${mappingBreakdown.manual.length} resources require manual migration (more than auto-convertible) — allocate extra testing time`);
    }
    const noise = analysisData?.noise;
    if (noise?.autoResolvedPercent > 30) {
      riskFactors.push(`${noise.autoResolvedPercent.toFixed(0)}% auto-resolved rate suggests noisy alerts that should be tuned before migration`);
    }
    if (teams.length > 5) {
      riskFactors.push(`${teams.length} teams involved — coordinate wave-based rollout to minimize disruption`);
    }
    if (riskFactors.length === 0) {
      riskFactors.push("Low overall complexity — straightforward migration path");
    }

    return { pilots, teams, phases, roadmapItems, timeline, mappingBreakdown, riskFactors };
  }, [evaluation, analysisData, projectPlan]);

  const togglePhase = (phaseNumber: number) => {
    const newSet = new Set(expandedPhases);
    if (newSet.has(phaseNumber)) newSet.delete(phaseNumber);
    else newSet.add(phaseNumber);
    setExpandedPhases(newSet);
  };

  const getWaveBadge = (wave: number) => {
    switch (wave) {
      case 1: return "bg-green-100 text-green-800";
      case 2: return "bg-yellow-100 text-yellow-800";
      case 3: return "bg-red-100 text-red-800";
      default: return "bg-zinc-100 text-zinc-800";
    }
  };

  const getRiskColor = (score: number) => {
    if (score <= 3) return "text-green-700";
    if (score <= 6) return "text-yellow-700";
    if (score <= 8) return "text-orange-700";
    return "text-red-700";
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

  // If no project plan, fall back to simple mapping-based view
  if (!projectPlan) {
    return <FallbackMigrationPlan evaluation={evaluation} />;
  }

  return (
    <div className="space-y-6">
      {/* Timeline Estimate */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <Clock className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm text-blue-900">Estimated Migration Timeline</p>
              <p className="text-2xl font-bold text-blue-900 mt-1">
                {timeline.totalWeeks ? `${timeline.totalWeeks} weeks` : "TBD"}
              </p>
              <div className="flex flex-wrap gap-4 mt-3 text-xs text-blue-800">
                {timeline.totalEffortDays && (
                  <span>Total Effort: <strong>{timeline.totalEffortDays} person-days</strong></span>
                )}
                {teams.length > 0 && (
                  <span>Teams: <strong>{teams.length}</strong></span>
                )}
                {timeline.complexityRating && (
                  <span>Complexity: <strong className="capitalize">{timeline.complexityRating}</strong></span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pilot Recommendations */}
      {pilots.length > 0 && (
        <Card className="border-green-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-5 w-5 text-green-600" />
              POV Pilot Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-zinc-600 mb-4">
              These teams are recommended for a 14-day Proof of Value based on lowest complexity, manageable scope, and clear success criteria.
            </p>
            {pilots.map((pilot: any, idx: number) => (
              <div key={idx} className="flex items-start gap-4 p-4 bg-green-50 rounded-lg border border-green-100">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-green-200 text-green-800 font-bold text-sm flex-shrink-0">
                  #{idx + 1}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm text-green-900">{pilot.teamName}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">Score: {pilot.score?.toFixed(1) || "N/A"}</Badge>
                    {pilot.serviceCount != null && (
                      <Badge variant="outline" className="text-xs">{pilot.serviceCount} services</Badge>
                    )}
                    {pilot.incidentVolume != null && (
                      <Badge variant="outline" className="text-xs">{pilot.incidentVolume} incidents</Badge>
                    )}
                  </div>
                  {pilot.reasons && pilot.reasons.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {pilot.reasons.map((reason: string, ri: number) => (
                        <li key={ri} className="text-xs text-green-800 flex items-start gap-1.5">
                          <CheckCircle2 className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          {reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Team Breakdown Table */}
      {teams.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Migration Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-center">Services</TableHead>
                    <TableHead className="text-center">Schedules</TableHead>
                    <TableHead className="text-center">Incidents</TableHead>
                    <TableHead className="text-center">Risk</TableHead>
                    <TableHead className="text-center">Wave</TableHead>
                    <TableHead className="text-center">Effort (days)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teams.map((team: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{team.teamName}</TableCell>
                      <TableCell className="text-center">{team.serviceCount}</TableCell>
                      <TableCell className="text-center">{team.scheduleCount || 0}</TableCell>
                      <TableCell className="text-center">{(team.incidentVolume || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-center">
                        <span className={`font-semibold ${getRiskColor(team.riskScore || 0)}`}>
                          {team.riskScore || 0}/10
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={getWaveBadge(team.recommendedWave || 1)}>
                          Wave {team.recommendedWave || 1}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">{team.effortDays || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex gap-4 mt-4 text-xs text-zinc-500">
              <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-green-500" /> Wave 1: Pilot (lowest risk)</span>
              <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-yellow-500" /> Wave 2: Core rollout</span>
              <span className="flex items-center gap-1"><div className="h-2 w-2 rounded-full bg-red-500" /> Wave 3: Complex teams</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase Timeline */}
      {phases.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg text-zinc-900 flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Migration Phases
          </h3>
          {phases.map((phase: any) => (
            <Card key={phase.number}>
              <button
                onClick={() => togglePhase(phase.number)}
                className="w-full text-left p-6 flex items-start justify-between hover:bg-zinc-50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary font-bold text-sm flex-shrink-0">
                      {phase.number}
                    </div>
                    <div>
                      <p className="font-semibold text-base text-zinc-900">{phase.title}</p>
                      <p className="text-sm text-zinc-600 mt-0.5">{phase.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-3 ml-11">
                    {phase.weekRange && (
                      <Badge variant="secondary" className="text-xs">
                        <Clock className="h-3 w-3 mr-1" />
                        {phase.weekRange}
                      </Badge>
                    )}
                    {phase.teamWaves && phase.teamWaves.length > 0 && (
                      <span className="text-xs text-zinc-500">
                        Waves: {[...new Set(phase.teamWaves)].join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown
                  className={`h-5 w-5 text-zinc-400 transition-transform flex-shrink-0 mt-1 ${
                    expandedPhases.has(phase.number) ? "rotate-180" : ""
                  }`}
                />
              </button>

              {expandedPhases.has(phase.number) && phase.tasks && phase.tasks.length > 0 && (
                <div className="border-t border-zinc-200 p-6 space-y-2">
                  {phase.tasks.map((task: string, idx: number) => (
                    <div key={idx} className="flex items-start gap-3 p-2">
                      <ArrowRight className="h-4 w-4 text-zinc-400 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-zinc-700">{task}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Tool Stack Replacement Roadmap */}
      {roadmapItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Tool Stack Replacement Roadmap
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Signal Type</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>incident.io Feature</TableHead>
                    <TableHead className="text-center">Phase</TableHead>
                    <TableHead>Effort</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roadmapItems.map((item: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium text-sm">{item.signalType || item.type}</TableCell>
                      <TableCell className="text-sm text-zinc-600">{item.serviceName || "Global"}</TableCell>
                      <TableCell className="text-sm">
                        {item.replacementFeature || item.incidentIoFeature || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className="text-xs">Phase {item.phase || "3"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-600">{item.effort || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

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
            <h4 className="font-semibold text-sm text-green-900 mb-2">1. Pre-migration & Discovery</h4>
            <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
              <li>Document all custom API integrations and webhook destinations</li>
              <li>Audit alert routing rules, escalation policies, and event orchestration</li>
              <li>Identify critical services and tool stack dependencies</li>
              {pilots.length > 0 && (
                <li>Select <strong>{pilots[0].teamName}</strong> as pilot team for 14-day POV</li>
              )}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm text-green-900 mb-2">2. Parallel Running</h4>
            <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
              <li>Run PagerDuty and incident.io side-by-side for 1-2 weeks per wave</li>
              <li>Start with Wave 1 (pilot teams), validate before expanding</li>
              <li>Monitor incident quality, MTTA/MTTR, and escalation accuracy on both platforms</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm text-green-900 mb-2">3. Wave-Based Cutover</h4>
            <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
              <li>Wave 1 → Wave 2 → Wave 3: progressive rollout by team risk</li>
              <li>Address tool stack replacements during Workflow phase (Phase 3)</li>
              <li>Maintain PagerDuty in read-only mode during transition with rollback plan</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Fallback component when no project plan data is available.
 * Uses migration mappings directly from the evaluation.
 */
function FallbackMigrationPlan({ evaluation }: { evaluation: any }) {
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([1]));

  const { phases, timelineEstimate } = useMemo(() => {
    const mappings = evaluation.migrationMappings || [];
    const autoResources = mappings.filter((m: any) => m.conversionStatus === "AUTO");
    const manualResources = mappings.filter((m: any) => m.conversionStatus === "MANUAL");
    const skipResources = mappings.filter((m: any) => m.conversionStatus === "SKIP");

    let manualEffort = 0;
    manualResources.forEach((r: any) => {
      const estimate = r.effortEstimate || "2d";
      if (estimate.includes("d")) manualEffort += parseInt(estimate) * 8;
      else if (estimate.includes("h")) manualEffort += parseInt(estimate);
    });

    const phases = [
      {
        number: 1,
        title: "Phase 1 — Auto-convert",
        description: "Automatically migrated resources with direct incident.io equivalents",
        resources: autoResources,
        effort: "< 1 day (automated)",
      },
      {
        number: 2,
        title: "Phase 2 — Manual effort",
        description: "Resources requiring manual configuration and testing in incident.io",
        resources: manualResources,
        effort: `${Math.ceil(manualEffort / 8)} days (${manualEffort}h)`,
      },
      {
        number: 3,
        title: "Phase 3 — Skip & cleanup",
        description: "Deprecated resources not needed in incident.io",
        resources: skipResources,
        effort: "Documentation only",
      },
    ];

    const estimatedDays = Math.ceil(manualEffort / 8) + 2;
    const timelineEstimate = `${estimatedDays}-${estimatedDays + 3} business days`;

    return { phases, timelineEstimate };
  }, [evaluation]);

  const togglePhase = (phaseNumber: number) => {
    const newSet = new Set(expandedPhases);
    if (newSet.has(phaseNumber)) newSet.delete(phaseNumber);
    else newSet.add(phaseNumber);
    setExpandedPhases(newSet);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "AUTO": return "bg-green-100 text-green-800";
      case "MANUAL": return "bg-yellow-100 text-yellow-800";
      case "SKIP": return "bg-zinc-100 text-zinc-800";
      default: return "bg-zinc-100 text-zinc-800";
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <Clock className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-blue-900">Estimated Timeline</p>
              <p className="text-2xl font-bold text-blue-900 mt-1">{timelineEstimate}</p>
              <p className="text-xs text-blue-800 mt-2">
                Run a new evaluation to generate a detailed team-based project plan.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

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
                {phase.resources.map((resource: any, idx: number) => (
                  <div key={idx} className="flex items-start justify-between p-3 bg-zinc-50 rounded">
                    <div className="flex-1">
                      <p className="font-medium text-sm text-zinc-900">{resource.pdResource?.name || "Unknown"}</p>
                      <p className="text-xs text-zinc-500 mt-1">Type: {resource.pdResource?.pdType || "unknown"}</p>
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
    </div>
  );
}
