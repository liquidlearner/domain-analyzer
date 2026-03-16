import { useMemo } from "react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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

interface Evaluation {
  id: string;
}

interface AlertSourcesTabProps {
  evaluation: Evaluation;
}

const COLORS = {
  primary: "#3b82f6",
  success: "#22c55e",
  warning: "#eab308",
  danger: "#ef4444",
};

export default function AlertSourcesTab({ evaluation }: AlertSourcesTabProps) {
  const { chartData, tableData, assessmentText } = useMemo(() => {
    // Simulated alert sources data
    const sources = [
      {
        name: "Datadog",
        type: "Monitoring",
        incidents: 450,
        percentage: 35.2,
      },
      {
        name: "AWS CloudWatch",
        type: "Cloud Platform",
        incidents: 380,
        percentage: 29.7,
      },
      {
        name: "PagerDuty Events API",
        type: "API",
        incidents: 210,
        percentage: 16.4,
      },
      {
        name: "Custom Webhooks",
        type: "Custom",
        incidents: 140,
        percentage: 10.9,
      },
      {
        name: "Slack Notifications",
        type: "Chat Integration",
        incidents: 60,
        percentage: 4.7,
      },
      {
        name: "Email",
        type: "Email",
        incidents: 40,
        percentage: 3.1,
      },
    ];

    const chartData = sources.map((s) => ({
      name: s.name,
      incidents: s.incidents,
    }));

    const tableData = sources;

    let assessmentText = "Unknown filtering status";
    const totalIncidents = sources.reduce((sum, s) => sum + s.incidents, 0);
    if (totalIncidents > 500) {
      assessmentText = "Minimal filtering: High incident volume suggests most alerts are being captured";
    } else if (totalIncidents > 200) {
      assessmentText = "Moderate filtering: Some alert deduplication or filtering is in place";
    } else if (totalIncidents > 0) {
      assessmentText = "Heavy filtering detected: Very few incidents reaching PagerDuty";
    }

    return { chartData, tableData, assessmentText };
  }, []);

  return (
    <div className="space-y-6">
      {/* Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Alert Volume by Source</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              layout="vertical"
              data={chartData}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis type="number" tick={{ fontSize: 12 }} stroke="#71717a" />
              <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 11 }} stroke="#71717a" />
              <Tooltip
                contentStyle={{ backgroundColor: "#fff", border: "1px solid #e4e4e7" }}
              />
              <Bar dataKey="incidents" fill={COLORS.primary} name="Incident Count" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Table */}
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
                {tableData.map((source) => (
                  <TableRow key={source.name}>
                    <TableCell className="font-medium">{source.name}</TableCell>
                    <TableCell>{source.type}</TableCell>
                    <TableCell className="text-right">
                      {source.incidents.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {source.percentage.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Assessment Card */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-base">Alert Filtering Assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-blue-900">{assessmentText}</p>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold text-blue-800">Key Observations:</p>
            <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
              <li>
                Datadog and AWS CloudWatch are the primary sources (~65% of volume)
              </li>
              <li>
                Custom API integrations represent a significant portion of incidents
              </li>
              <li>
                Email and Slack are minor sources, indicating good alert routing
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}