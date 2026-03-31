"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Users, Zap, GitBranch, Bot, Bell } from "lucide-react";

interface EntitlementsTabProps {
  evaluation: {
    id: string;
  };
}

// Abilities grouped into display categories
const ABILITY_GROUPS: Array<{
  label: string;
  icon: React.ReactNode;
  abilities: Array<{ key: string; label: string; description: string }>;
}> = [
  {
    label: "AIOps & Alert Grouping",
    icon: <Zap className="h-4 w-4" />,
    abilities: [
      {
        key: "event_intelligence",
        label: "Event Intelligence / AIOps",
        description: "Intelligent alert grouping and noise reduction",
      },
      {
        key: "preview_intelligent_alert_grouping",
        label: "Intelligent Alert Grouping (Preview)",
        description: "ML-based alert grouping preview access",
      },
      {
        key: "preview_machine_learning_early_access",
        label: "Machine Learning Early Access",
        description: "Early access to ML-based features",
      },
    ],
  },
  {
    label: "Automation",
    icon: <Bot className="h-4 w-4" />,
    abilities: [
      {
        key: "automation_actions",
        label: "Automation Actions",
        description: "Runbook automation triggered from incidents",
      },
      {
        key: "incident_workflows",
        label: "Incident Workflows",
        description: "Automated multi-step incident response workflows",
      },
    ],
  },
  {
    label: "Event Orchestration",
    icon: <GitBranch className="h-4 w-4" />,
    abilities: [
      {
        key: "event_orchestration",
        label: "Event Orchestration",
        description: "Global event routing and enrichment",
      },
      {
        key: "alert_grouping_parameters",
        label: "Alert Grouping Parameters",
        description: "Time-based and content-based alert grouping config",
      },
    ],
  },
  {
    label: "On-Call & Response",
    icon: <Bell className="h-4 w-4" />,
    abilities: [
      {
        key: "stakeholder_communications",
        label: "Stakeholder Communications",
        description: "Status updates and stakeholder notification",
      },
      {
        key: "response_mobilizer",
        label: "Response Mobilizer",
        description: "Add responders to active incidents",
      },
      {
        key: "conference_bridge",
        label: "Conference Bridge",
        description: "Embedded conference call integration",
      },
      {
        key: "business_service_monitoring",
        label: "Business Service Monitoring",
        description: "Business services and service health views",
      },
    ],
  },
];

// User role → license tier display mapping
const ROLE_DISPLAY: Record<string, { label: string; tier: "full" | "limited" | "stakeholder" | "observer" }> = {
  admin:                    { label: "Admin (Full User)",          tier: "full" },
  user:                     { label: "Full User",                  tier: "full" },
  limited_user:             { label: "Limited User",               tier: "limited" },
  read_only_user:           { label: "Read-Only User",             tier: "limited" },
  read_only_limited_user:   { label: "Read-Only Limited User",     tier: "stakeholder" },
  stakeholder:              { label: "Stakeholder",                tier: "stakeholder" },
  observer:                 { label: "Observer",                   tier: "observer" },
};

const TIER_COLORS: Record<string, string> = {
  full:        "bg-green-100 text-green-800 border-green-200",
  limited:     "bg-blue-100 text-blue-800 border-blue-200",
  stakeholder: "bg-amber-100 text-amber-800 border-amber-200",
  observer:    "bg-zinc-100 text-zinc-700 border-zinc-200",
};

export default function EntitlementsTab({ evaluation }: EntitlementsTabProps) {
  const { data, isLoading } = trpc.evaluation.getEntitlements.useQuery(
    { id: evaluation.id },
    { enabled: !!evaluation.id }
  );

  if (isLoading) {
    return (
      <div className="p-8 text-center text-zinc-500 text-sm">
        Loading entitlement data...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center">
        <p className="text-zinc-500 text-sm">
          No entitlement data available. Run a config sync to capture account abilities.
        </p>
      </div>
    );
  }

  if (!data.hasAccountInfo) {
    return (
      <div className="p-8 text-center">
        <p className="text-zinc-500 text-sm">
          Account abilities not yet captured. Run a new config sync to populate this data.
        </p>
      </div>
    );
  }

  const abilitiesSet = new Set(data.abilities);

  // Aggregate user counts by tier
  const tierCounts: Record<string, number> = { full: 0, limited: 0, stakeholder: 0, observer: 0 };
  let totalUsers = 0;
  for (const [role, count] of Object.entries(data.usersByRole)) {
    const tier = ROLE_DISPLAY[role]?.tier ?? "full";
    tierCounts[tier] = (tierCounts[tier] || 0) + count;
    totalUsers += count;
  }

  return (
    <div className="space-y-6 mt-4">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="text-xs">
          {data.abilities.length} abilities detected
        </Badge>
        <Badge variant="outline" className="text-xs">
          {totalUsers} total users
        </Badge>
      </div>

      {/* Feature Entitlements */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wide">
          Feature Entitlements
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ABILITY_GROUPS.map((group) => (
            <Card key={group.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {group.icon}
                  {group.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {group.abilities.map((ability) => {
                    const enabled = abilitiesSet.has(ability.key);
                    return (
                      <div key={ability.key} className="flex items-start gap-2">
                        {enabled ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="h-4 w-4 text-zinc-300 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className={`text-sm font-medium ${enabled ? "text-zinc-900" : "text-zinc-400"}`}>
                            {ability.label}
                          </p>
                          <p className="text-xs text-zinc-500">{ability.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Raw abilities not covered by groups */}
      {(() => {
        const knownAbilities = new Set(
          ABILITY_GROUPS.flatMap((g) => g.abilities.map((a) => a.key))
        );
        const unknown = data.abilities.filter((a) => !knownAbilities.has(a));
        if (unknown.length === 0) return null;
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Other Detected Abilities</CardTitle>
              <CardDescription className="text-xs">
                Abilities returned by the API not categorized above
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {unknown.map((a) => (
                  <Badge key={a} variant="secondary" className="text-xs font-mono">
                    {a}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* User License Breakdown */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wide">
          User License Breakdown
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["full", "limited", "stakeholder", "observer"] as const).map((tier) => {
            const count = tierCounts[tier] || 0;
            const pct = totalUsers > 0 ? Math.round((count / totalUsers) * 100) : 0;
            const tierLabels: Record<string, string> = {
              full:        "Full Users",
              limited:     "Limited Users",
              stakeholder: "Stakeholders",
              observer:    "Observers",
            };
            return (
              <Card key={tier} className={count > 0 ? "" : "opacity-50"}>
                <CardContent className="pt-4 pb-4 text-center">
                  <Users className="h-5 w-5 mx-auto mb-1 text-zinc-400" />
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-xs font-medium text-zinc-600 mt-1">{tierLabels[tier]}</p>
                  {count > 0 && (
                    <p className="text-xs text-zinc-400 mt-0.5">{pct}% of total</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Per-role detail table */}
        {Object.keys(data.usersByRole).length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Role Detail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {Object.entries(data.usersByRole)
                  .sort(([, a], [, b]) => b - a)
                  .map(([role, count]) => {
                    const display = ROLE_DISPLAY[role] ?? { label: role, tier: "full" as const };
                    return (
                      <div key={role} className="flex items-center justify-between py-1 border-b border-zinc-100 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded border ${TIER_COLORS[display.tier]}`}>
                            {display.label}
                          </span>
                        </div>
                        <span className="text-sm font-medium">{count}</span>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Plan inference notes */}
      {data.abilities.length > 0 && (
        <Card className="bg-zinc-50 border-zinc-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Plan Inference</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm text-zinc-700">
              {abilitiesSet.has("event_intelligence") && (
                <p>✓ <strong>AIOps / Event Intelligence</strong> is active on this account.</p>
              )}
              {abilitiesSet.has("automation_actions") && (
                <p>✓ <strong>Automation Actions</strong> (runbook automation) is licensed.</p>
              )}
              {abilitiesSet.has("incident_workflows") && (
                <p>✓ <strong>Incident Workflows</strong> is available on this plan.</p>
              )}
              {abilitiesSet.has("event_orchestration") && (
                <p>✓ <strong>Event Orchestration</strong> is enabled.</p>
              )}
              {!abilitiesSet.has("event_intelligence") && !abilitiesSet.has("automation_actions") && !abilitiesSet.has("incident_workflows") && (
                <p className="text-zinc-500">No advanced plan features detected. Account appears to be on a standard plan.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
