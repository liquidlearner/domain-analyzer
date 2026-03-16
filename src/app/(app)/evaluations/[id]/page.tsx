"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { AlertCircle, Loader2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import OverviewTab from "./tabs/overview";
import ConfigMapTab from "./tabs/config-map";
import VolumeNoiseTab from "./tabs/volume-noise";
import AlertSourcesTab from "./tabs/alert-sources";
import ShadowStackTab from "./tabs/shadow-stack";
import MigrationPlanTab from "./tabs/migration-plan";

interface ProgressMessage {
  step: string;
  progress: number;
  message: string;
}

export default function EvaluationPage() {
  const params = useParams();
  const evaluationId = params.id as string;
  const { toast } = useToast();

  const { data: evaluation, isLoading, refetch } = trpc.evaluation.getById.useQuery({
    id: evaluationId,
  });

  const cancelMutation = trpc.evaluation.cancel.useMutation();
  const [progressMessage, setProgressMessage] = useState<ProgressMessage | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);

  // Setup SSE subscription for progress
  useEffect(() => {
    if (!evaluation || evaluation.status === "COMPLETED" || evaluation.status === "FAILED") {
      return;
    }

    const eventSource = new EventSource(`/api/jobs/${evaluationId}/progress`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ProgressMessage;
        setProgressMessage(data);
        setProgressPercent(data.progress);

        // Refetch evaluation data when completed
        if (data.progress >= 100) {
          setTimeout(() => refetch(), 1000);
        }
      } catch (error) {
        console.error("Failed to parse progress message:", error);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [evaluation, evaluationId, refetch]);

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync({ id: evaluationId });
      toast({
        title: "Success",
        description: "Evaluation cancelled",
      });
      refetch();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to cancel evaluation",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-500" />
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

  const isRunning = !["COMPLETED", "FAILED", "CANCELLED"].includes(evaluation.status);
  const domainSubdomain = evaluation.domain?.subdomain || "unknown";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Evaluation Results`}
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
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                <div>
                  <p className="font-semibold text-sm">Analysis in progress</p>
                  <p className="text-xs text-zinc-600">
                    {progressMessage?.message || `Current status: ${evaluation.status}`}
                  </p>
                </div>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <p className="text-xs text-zinc-500">{Math.round(progressPercent)}% complete</p>
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
            <TabsTrigger value="shadow-stack">Shadow Stack</TabsTrigger>
            <TabsTrigger value="migration">Migration Plan</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab evaluation={evaluation} />
          </TabsContent>

          <TabsContent value="config-map">
            <ConfigMapTab evaluation={evaluation} />
          </TabsContent>

          <TabsContent value="volume-noise">
            <VolumeNoiseTab evaluation={evaluation} />
          </TabsContent>

          <TabsContent value="sources">
            <AlertSourcesTab evaluation={evaluation} />
          </TabsContent>

          <TabsContent value="shadow-stack">
            <ShadowStackTab evaluation={evaluation} />
          </TabsContent>

          <TabsContent value="migration">
            <MigrationPlanTab evaluation={evaluation} />
          </TabsContent>
        </Tabs>
      )}

      {/* Failed State */}
      {evaluation.status === "FAILED" && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-red-900">Evaluation Failed</p>
                <p className="text-sm text-red-700 mt-1">
                  The evaluation encountered an error during processing. Please try again or contact support.
                </p>
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