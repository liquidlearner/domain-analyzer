"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Circle, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";

interface Resource {
  id: string;
  pdId: string;
  name: string;
  pdType: string;
  teamIds: string[];
}

interface ScopeOption {
  id: string;    // PD ID (not Prisma ID)
  name: string;
  resourceCount: number;
}

const TIME_RANGE_OPTIONS = [
  { label: "1 Day", value: "1" },
  { label: "7 Days", value: "7" },
  { label: "30 Days", value: "30" },
  { label: "90 Days", value: "90" },
  { label: "12 Months", value: "365" },
];

export default function EvaluatePage() {
  const params = useParams();
  const router = useRouter();
  const domainId = params.id as string;
  const { toast } = useToast();

  const { data: domain, isLoading: domainLoading } = trpc.domain.getById.useQuery({
    id: domainId,
  });

  const createMutation = trpc.evaluation.create.useMutation();

  const [scopeType, setScopeType] = useState<"TEAM" | "SERVICE">("SERVICE");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = useState<"1" | "7" | "30" | "90" | "365">("90");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());

  // Extract and organize resources from snapshot — use pdId (PagerDuty ID)
  const { teams, services } = useMemo(() => {
    if (!domain?.latestSnapshot?.resources) {
      return { teams: [], services: [] };
    }

    const resources = domain.latestSnapshot.resources as Resource[];

    // Build teams: pdType=TEAM resources, count how many other resources reference each team
    const teams: ScopeOption[] = resources
      .filter((r) => r.pdType === "TEAM")
      .map((team) => ({
        id: team.pdId,
        name: team.name || "Unnamed Team",
        resourceCount: resources.filter(
          (r) => r.pdType !== "TEAM" && r.teamIds?.includes(team.pdId)
        ).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Build services: pdType=SERVICE resources
    const services: ScopeOption[] = resources
      .filter((r) => r.pdType === "SERVICE")
      .map((svc) => ({
        id: svc.pdId,
        name: svc.name || "Unnamed Service",
        resourceCount: 1,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { teams, services };
  }, [domain]);

  const scopeOptions = scopeType === "TEAM" ? teams : services;

  const filteredOptions = useMemo(() => {
    return scopeOptions.filter((opt) =>
      opt.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [scopeOptions, searchQuery]);

  const handleSelectAll = () => {
    setSelectedIds(new Set(scopeOptions.map((opt) => opt.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleToggleItem = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleDetails = (id: string) => {
    const newSet = new Set(expandedDetails);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedDetails(newSet);
  };

  const handleStartAnalysis = async () => {
    if (selectedIds.size === 0) {
      toast({
        title: "Error",
        description: `Please select at least one ${scopeType === "TEAM" ? "team" : "service"}`,
        variant: "destructive",
      });
      return;
    }

    try {
      const evaluation = await createMutation.mutateAsync({
        domainId,
        scopeType,
        scopeIds: Array.from(selectedIds),
        timeRangeDays: timeRange,
      });

      toast({
        title: "Success",
        description: "Analysis started. Redirecting...",
      });

      router.push(`/evaluations/${evaluation.id}`);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start analysis",
        variant: "destructive",
      });
    }
  };

  if (domainLoading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (!domain) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600">Domain not found</p>
      </div>
    );
  }

  const subdomain = domain.subdomain || "unknown";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`New Evaluation for ${subdomain}`}
        description="Configure the scope and time range for your analysis"
      />

      {/* Scope Type Selection */}
      <div>
        <Label className="text-base font-semibold mb-3 block">Scope Type</Label>
        <div className="grid grid-cols-2 gap-4">
          {(["TEAM", "SERVICE"] as const).map((type) => (
            <button
              key={type}
              onClick={() => {
                setScopeType(type);
                setSelectedIds(new Set());
                setSearchQuery("");
              }}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                scopeType === type
                  ? "border-primary bg-primary-light"
                  : "border-zinc-200 bg-white hover:border-zinc-300"
              }`}
            >
              <div className="flex items-center gap-2">
                {scopeType === type ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Circle className="h-5 w-5 text-zinc-400" />
                )}
                <div>
                  <p className="font-semibold text-sm">By {type === "TEAM" ? "Team" : "Service"}</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {type === "TEAM"
                      ? "Analyze by team assignment"
                      : "Analyze by individual service"}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selection List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Select {scopeType === "TEAM" ? "Teams" : "Services"}</CardTitle>
              <CardDescription>
                {selectedIds.size} of {scopeOptions.length} selected
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeselectAll}
              >
                Deselect All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Input */}
          <Input
            placeholder={`Search ${scopeType === "TEAM" ? "teams" : "services"}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4"
          />

          {/* Items List */}
          <div className="space-y-2 max-h-96 overflow-y-auto border border-zinc-200 rounded-lg p-4">
            {filteredOptions.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-4">
                No {scopeType === "TEAM" ? "teams" : "services"} found
              </p>
            ) : (
              filteredOptions.map((option) => (
                <div key={option.id}>
                  <button
                    onClick={() => handleToggleItem(option.id)}
                    className="w-full text-left p-3 rounded-lg border border-zinc-200 hover:bg-zinc-50 transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div
                        className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedIds.has(option.id)
                            ? "bg-primary border-primary"
                            : "border-zinc-300"
                        }`}
                      >
                        {selectedIds.has(option.id) && (
                          <div className="w-3 h-3 bg-white rounded-sm" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{option.name}</p>
                        <p className="text-xs text-zinc-500">{option.resourceCount} resources</p>
                      </div>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDetails(option.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          toggleDetails(option.id);
                        }
                      }}
                      className="p-1 text-zinc-400 hover:text-zinc-600"
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          expandedDetails.has(option.id) ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </button>

                  {/* Details Row */}
                  {expandedDetails.has(option.id) && (
                    <div className="ml-8 mt-2 p-3 bg-zinc-50 rounded-lg text-sm text-zinc-600">
                      <p>
                        {scopeType === "TEAM"
                          ? `Team ID: ${option.id}`
                          : `Service ID: ${option.id}`}
                      </p>
                      <p className="mt-1">
                        Resources associated: {option.resourceCount}
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Time Range Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Time Range</CardTitle>
          <CardDescription>Select the period to analyze</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-3">
            {TIME_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeRange(option.value as "1" | "7" | "30" | "90" | "365")}
                className={`p-4 rounded-lg border-2 text-center transition-colors ${
                  timeRange === option.value
                    ? "border-primary bg-primary-light"
                    : "border-zinc-200 bg-white hover:border-zinc-300"
                }`}
              >
                <p className="font-semibold text-sm">{option.label}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Summary Card */}
      <Card className="bg-zinc-50 border-zinc-200">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-semibold">Analyzing:</span>{" "}
              <span className="text-zinc-600">
                {selectedIds.size} {scopeType === "TEAM" ? "teams" : "services"} over{" "}
                {TIME_RANGE_OPTIONS.find((opt) => opt.value === timeRange)?.label}
              </span>
            </p>
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {Array.from(selectedIds).map((id) => {
                  const option = scopeOptions.find((opt) => opt.id === id);
                  return (
                    <Badge key={id} variant="secondary">
                      {option?.name}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Button */}
      <div className="flex gap-3 justify-center pt-4">
        <Button
          variant="outline"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button
          size="lg"
          onClick={handleStartAnalysis}
          disabled={selectedIds.size === 0 || createMutation.isPending}
        >
          {createMutation.isPending ? "Starting..." : "Start Analysis"}
        </Button>
      </div>
    </div>
  );
}