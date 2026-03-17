"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, Loader2, X, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import OverviewTab from "./tabs/overview";
import ConfigMapTab from "./tabs/config-map";
import VolumeNoiseTab from "./tabs/volume-noise";
import AlertSourcesTab from "./tabs/alert-sources";
import ToolStackTab from "./tabs/tool-stack";
import MigrationPlanTab from "./tabs/migration-plan";

interface ProgressData {
  status: string;
  progress: number;
  message: string;
}

export default function EvaluationPage() {
  const params = useParams();
  const evaluationId = params.id as string;
  const { toast } = useToast();

  const { data: evaluation, isLoading, refetch } = trpc.evaluation.getById.useQuery(
    { id: evaluationId },
    { refetchInterval: (query) => {
      // Auto-refetch while running
      const status = query.state.data?.status;
      if (status && !["COMPLETED", "FAILED", "CANCELLED"].includes(status)) {
        return 3000;
      }
      return false;
    }},
  );

  const cancelMutation = trpc.evaluation.cancel.useMutation();
  const retryMutation = trpc.evaluation.retry.useMutation();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);

  // Setup SSE subscription for progress
  useEffect(() => {
    if (!evaluation || ["COMPLETED", "FAILED", "CANCELLED"].includes(evaluation.status)) {
      return;
    }

    let eventSource: EventSource | null = null;
    let retryTimeout: NodeJS.Timeout | null = null;
    let retryCount = 0;
    const maxRetries = 10;

    const connect = () => {
      eventSource = new EventSource(`/api/jobs/${evaluationId}/progress`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ProgressData;

          // Ignore "not_found" — the job may not have started yet
          if (data.status === "not_found") {
            retryCount++;
            if (retryCount < maxRetries) {
              eventSource?.close();
              retryTimeout = setTimeout(connect, 2000);
            }
            return;
          }

          retryCount = 0; // Reset on valid data
          setProgressData(data);

          // Refetch evaluation data when completed or failed
          if (data.status === "completed" || data.status === "failed") {
            // Refetch immediately, then again after a short delay to ensure DB is updated
            refetch();
            setTimeout(() => refetch(), 1500);
            setTimeout(() => refetch(), 4000);
          }
        } catch (error) {
          console.error("Failed to parse progress message:", error);
        }
      };

      eventSource.onerror = () => {
        eventSource?.close();
        // Retry connection after a delay
        if (retryCount < maxRetries) {
          retryCount++;
          retryTimeout = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      eventSource?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [evaluation?.status, evaluationId, refetch]);

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync({ id: evaluationId });
      toast({ title: "Success", description: "Evaluation cancelled" });
      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to cancel evaluation",
        variant: "destructive",
      });
    }
  };

  const handleRetry = async () => {
    try {
      await retryMutation.mutateAsync({ id: evaluationId });
      setProgressData(null);
      toast({ title: "Success", description: "Evaluation restarted" });
      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to retry evaluation",
        variant: "destructive",
      });
    }
  };

  // Fetch deserialized analysis data for completed evaluations
  // Must be before any early returns to maintain consistent hook order
  const { data: analysisData } = trpc.evaluation.getAnalysisData.useQuery(
    { id: evaluationId },
    { enabled: evaluation?.status === "COMPLETED" }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-zinc-600">Loading evaluation...</p>
        </div>
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600">Evaluation not found</p>
      </div>
    );
  }

  const dbIsTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(evaluation.status);
  const sseIsCompleted = progressData?.status === "completed";
  const isRunning = !dbIsTerminal && !sseIsCompleted;
  const domainSubdomain = evaluation.domain?.subdomain || "unknown";
  const progressPercent = progressData?.progress ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evaluation Results"
        description={`${domainSubdomain}.pagerduty.com`}
        actions={
          isRunning ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          ) : null
        }
      />

      {/* Running State */}
      {isRunning && (
        <Card className="border-primary-muted bg-primary-light">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <p className="font-semibold text-sm">Analysis in progress</p>
                  <p className="text-xs text-zinc-600">
                    {progressData?.message || `Current status: ${evaluation.status}`}
                  </p>
                </div>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <p className="text-xs text-zinc-500">{Math.round(progressPercent)}% complete</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completing State — SSE done, waiting for DB refresh */}
      {sseIsCompleted && !dbIsTerminal && (
        <Card className="border-primary-muted bg-primary-light">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="font-semibold text-sm">Analysis complete — loading results...</p>
                <p className="text-xs text-zinc-600">{progressData?.message}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed State - Tabbed Interface */}
      {evaluation.status === "COMPLETED" && (
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="config-map">Config Map</TabsTrigger>
            <TabsTrigger value="volume-noise">Volume & Noise</TabsTrigger>
            <TabsTrigger value="sources">Alert Sources</TabsTrigger>
            <TabsTrigger value="tool-stack">Tool Stack</TabsTrigger>
            <TabsTrigger value="migration">Migration Plan</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab evaluation={evaluation} analysisData={analysisData} />
          </TabsContent>

          <TabsContent value="config-map">
            <ConfigMapTab evaluation={evaluation} />
          </TabsContent>

          <TabsContent value="volume-noise">
            <VolumeNoiseTab evaluation={evaluation} analysisData={analysisData} />
          </TabsContent>

          <TabsContent value="sources">
            <AlertSourcesTab evaluation={evaluation} analysisData={analysisData} />
          </TabsContent>

          <TabsContent value="tool-stack">
            <ToolStackTab evaluation={evaluation} analysisData={analysisData} />
          </TabsContent>

          <TabsContent value="migration">
            <MigrationPlanTab evaluation={evaluation} analysisData={analysisData} />
          </TabsContent>
        </Tabs>
      )}

      {/* Failed State */}
      {evaluation.status === "FAILED" && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-sm text-red-900">Evaluation Failed</p>
                <p className="text-sm text-red-700 mt-1">
                  {progressData?.message || "The evaluation encountered an error during processing."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={handleRetry}
                  disabled={retryMutation.isPending}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {retryMutation.isPending ? "Retrying..." : "Retry Analysis"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancelled State */}
      {evaluation.status === "CANCELLED" && (
        <Card className="border-zinc-200 bg-zinc-50">
          <CardContent className="pt-6">
            <p className="text-sm text-zinc-600">This evaluation was cancelled.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
