import { useMemo } from "react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface AlertSourcesTabProps {
  evaluation: any;
  analysisData?: any;
}

export default function AlertSourcesTab({ evaluation, analysisData }: AlertSourcesTabProps) {
  const sources = analysisData?.sources;

  const { chartData, tableData, assessmentText, observations } = useMemo(() => {
    const sourceList: any[] = sources?.sources || [];

    const chartData = sourceList.map((s: any) => ({
      name: s.sourceName || "Unknown",
      incidents: s.incidentCount || 0,
    }));

    const tableData = sourceList.map((s: any) => ({
      name: s.sourceName || "Unknown",
      type: s.integrationType || "unknown",
      incidents: s.incidentCount || 0,
      percentage: s.percentOfTotal || 0,
    }));

    // Assessment
    const assessment = sources?.preFilteredAssessment || "unknown";
    let assessmentText = "Alert filtering status could not be determined.";
    if (assessment === "heavy filtering detected") {
      assessmentText = "Heavy filtering detected: significant event deduplication or suppression is in place before incidents reach PagerDuty.";
    } else if (assessment === "minimal filtering") {
      assessmentText = "Minimal filtering: most alerts are flowing through to PagerDuty without significant pre-filtering.";
    }

    if (sources?.criticalOnlyDetection) {
      assessmentText += " Note: >95% of incidents are high urgency — this suggests critical-only alerting is configured.";
    }

    // Dynamic observations
    const observations: string[] = [];
    if (sourceList.length > 0) {
      const top = sourceList[0];
      observations.push(`${top.sourceName} is the primary alert source (${top.percentOfTotal?.toFixed(1)}% of volume)`);
    }
    if (sourceList.length > 1) {
      const topTwo = sourceList.slice(0, 2);
      const combinedPct = topTwo.reduce((sum: number, s: any) => sum + (s.percentOfTotal || 0), 0);
      if (combinedPct > 60) {
        observations.push(`Top 2 sources account for ${combinedPct.toFixed(0)}% of all incidents`);
      }
    }
    const monitoringTotal = sources?.totalFromMonitoring || 0;
    const apiTotal = sources?.totalFromApi || 0;
    const emailTotal = sources?.totalFromEmail || 0;
    const orchestrationTotal = sources?.totalFromOrchestration || 0;
    if (orchestrationTotal > 0) {
      observations.push(`${orchestrationTotal.toLocaleString()} incidents routed via Global Event Orchestration — create per-service alert routing rules in incident.io to replace dynamic routing`);
    }
    if (monitoringTotal > apiTotal && monitoringTotal > orchestrationTotal) {
      observations.push("Monitoring integrations are the dominant alert source — good signal for incident.io alert source migration");
    }
    if (apiTotal > 0) {
      observations.push(`${apiTotal} incidents from direct API calls — these endpoints need repointing to incident.io`);
    }
    if (emailTotal > 0) {
      observations.push(`${emailTotal} incidents from email integrations — incident.io supports email alert sources natively`);
    }

    // Orchestration routing recommendations
    const orchestrationRouting = sources?.orchestrationRouting || [];
    orchestrationRouting.forEach((eo: any) => {
      observations.push(`"${eo.orchestrationName}": ${eo.ruleCount} dynamic routing rules → ${eo.routedServiceCount} services. ${eo.recommendation}`);
    });

    return { chartData, tableData, assessmentText, observations };
  }, [sources]);

  if (!analysisData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-zinc-500">Analysis data not available. Run a new evaluation to generate results.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Alert Volume by Source</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
              <BarChart layout="vertical" data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke="#71717a" />
                <YAxis dataKey="name" type="category" width={200} tick={{ fontSize: 11 }} stroke="#71717a" />
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e4e4e7" }} />
                <Bar dataKey="incidents" fill="#F25533" name="Incident Count" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-500 py-8 text-center">No source data available</p>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      {tableData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Alert Sources Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source Name</TableHead>
                    <TableHead>Integration Type</TableHead>
                    <TableHead className="text-right">Incident Count</TableHead>
                    <TableHead className="text-right">% of Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.map((source: any) => (
                    <TableRow key={source.name}>
                      <TableCell className="font-medium">{source.name}</TableCell>
                      <TableCell className="capitalize">{source.type}</TableCell>
                      <TableCell className="text-right">{source.incidents.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{source.percentage.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assessment Card */}
      <Card className="bg-primary-light border-primary-muted">
        <CardHeader>
          <CardTitle className="text-base">Alert Filtering Assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-800">{assessmentText}</p>
          {observations.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-700">Key Observations:</p>
              <ul className="text-xs text-zinc-700 space-y-1 list-disc list-inside">
                {observations.map((obs, idx) => (
                  <li key={idx}>{obs}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
