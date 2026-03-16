"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RefreshCw, Zap } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";

type ResourceType =
  | "SERVICE"
  | "TEAM"
  | "SCHEDULE"
  | "ESCALATION_POLICY"
  | "USER"
  | "BUSINESS_SERVICE"
  | "RULESET";

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  SERVICE: "Services",
  TEAM: "Teams",
  SCHEDULE: "Schedules",
  ESCALATION_POLICY: "Escalation Policies",
  USER: "Users",
  BUSINESS_SERVICE: "Business Services",
  RULESET: "Rulesets",
};

export default function DomainDetailPage() {
  const params = useParams();
  const domainId = params.id as string;
  const { toast } = useToast();
  const [filterType, setFilterType] = useState<ResourceType | "all">("all");

  const { data: domain, isLoading, error } = trpc.domain.getById.useQuery({
    id: domainId,
  });

  const validateMutation = trpc.domain.validateConnection.useMutation();
  const updateTokenMutation = trpc.domain.updateToken.useMutation();

  const handleValidateConnection = async () => {
    try {
      await validateMutation.mutateAsync({ domainId });
      toast({
        title: "Success",
        description: "Connection validated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to validate connection",
        variant: "destructive",
      });
    }
  };

  const handleRunAnalysis = () => {
    window.location.href = `/domains/${domainId}/evaluate`;
  };

  if (isLoading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (error || !domain) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600">Failed to load domain</p>
        <Button asChild className="mt-4">
          <Link href="/customers">Back to Customers</Link>
        </Button>
      </div>
    );
  }

  const resourceCounts = domain.latestSnapshot?.resourceCounts as Record<string, number> || {};
  const hasSnapshot = !!domain.latestSnapshot;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${domain.subdomain}.pagerduty.com`}
        description="Domain configuration and analysis"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleValidateConnection}
              disabled={validateMutation.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Validate Connection
            </Button>
            <Button
              onClick={handleRunAnalysis}
              disabled={!hasSnapshot}
            >
              <Zap className="mr-2 h-4 w-4" />
              Run Analysis
            </Button>
          </div>
        }
      />

      {/* Status Badge */}
      <div className="flex gap-2 items-center">
        <StatusBadge status={domain.status} />
      </div>

      {/* Connection Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Connection Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-zinc-500 font-medium">Status</p>
              <p className="text-sm font-semibold mt-1">
                <StatusBadge status={domain.status} />
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 font-medium">Connected</p>
              <p className="text-sm font-semibold mt-1">
                {formatDate(domain.connectedAt)}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 font-medium">Last Validated</p>
              <p className="text-sm font-semibold mt-1">
                {domain.lastValidated ? formatDate(domain.lastValidated) : "Never"}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 font-medium">Token (Last 4)</p>
              <p className="text-sm font-semibold font-mono mt-1">
                ••••{domain.tokenLast4}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Config Snapshot Section */}
      {!hasSnapshot ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              title="No configuration captured"
              description="Run an analysis to capture the current PagerDuty configuration"
              action={
                <Button onClick={handleRunAnalysis}>
                  <Zap className="mr-2 h-4 w-4" />
                  Run First Analysis
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Resource Count Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Object.entries(RESOURCE_TYPE_LABELS).map(([type, label]) => {
              const count = resourceCounts[type] || 0;
              return (
                <Card key={type}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-zinc-600">
                      {label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-zinc-900">{count}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Resource Inventory Table */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Resource Inventory</CardTitle>
              <select
                value={filterType}
                onChange={(e) =>
                  setFilterType(e.target.value as ResourceType | "all")
                }
                className="px-2 py-1 text-sm border border-zinc-200 rounded"
              >
                <option value="all">All Resources</option>
                {Object.entries(RESOURCE_TYPE_LABELS).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-zinc-500">
                <p className="text-sm">Resource inventory data will be displayed here</p>
                <p className="text-xs mt-2">Configure integration to view detailed resource list</p>
              </div>
            </CardContent>
          </Card>

          {/* Run Analysis Button */}
          <div className="flex justify-center">
            <Button
              size="lg"
              onClick={handleRunAnalysis}
            >
              <Zap className="mr-2 h-4 w-4" />
              Run Detailed Analysis
            </Button>
          </div>
        </>
      )}
    </div>
  );
}