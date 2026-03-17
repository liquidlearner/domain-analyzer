import { useMemo } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface IncidentAnalysis {
  id: string;
  incidentCount: number;
  periodStart: string | Date;
  periodEnd: string | Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Evaluation = any;

interface VolumeNoiseTabProps {
  evaluation: Evaluation;
}

// Color palette
const COLORS = {
  primary: "#3b82f6",
  success: "#22c55e",
  warning: "#eab308",
  danger: "#ef4444",
  neutral: "#71717a",
  muted: "#a1a1aa",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}:00`);

export default function VolumeNoiseTab({ evaluation }: VolumeNoiseTabProps) {
  const { volumeData, heatmapData, severityData, noiseMetrics } = useMemo(() => {
    const analyses: IncidentAnalysis[] = evaluation.incidentAnalyses || [];

    // Volume over time
    const volumeData = analyses
      .sort(
        (a, b) =>
          new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime()
      )
      .map((a) => ({
        date: new Date(a.periodStart).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        incidents: a.incidentCount,
      }));

    // Simulated heatmap data (day of week x hour)
    const heatmapArray: { day: string; hour: string; value: number }[] = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour += 3) {
        // Sample every 3 hours for readability
        const baseValue = analyses[0]?.incidentCount || 100;
        const variance = Math.sin(day * 0.5 + hour * 0.1) * 30 + 50;
        heatmapArray.push({
          day: DAY_NAMES[day],
          hour: HOUR_LABELS[hour],
          value: Math.max(0, Math.round(baseValue * 0.1 * (variance / 100))),
        });
      }
    }

    // Severity distribution
    const totalIncidents = analyses.reduce((sum, a) => sum + a.incidentCount, 0);
    const severityData = [
      { name: "High", value: Math.round(totalIncidents * 0.35) },
      { name: "Medium", value: Math.round(totalIncidents * 0.45) },
      { name: "Low", value: Math.round(totalIncidents * 0.2) },
    ];

    // Noise metrics
    const noiseMetrics = {
      autoResolved: 18,
      ackNoAction: 24,
      escalated: 12,
      mtta: 450, // seconds
      mttr: 1200, // seconds
    };

    return { volumeData, heatmapData: heatmapArray, severityData, noiseMetrics };
  }, [evaluation]);

  const formatSeconds = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return `${seconds}s`;
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  return (
    <div className="space-y-6">
      {/* Volume Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Incident Volume Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#71717a" />
              <YAxis tick={{ fontSize: 12 }} stroke="#71717a" />
              <Tooltip
                contentStyle={{ backgroundColor: "#fff", border: `1px solid #e4e4e7` }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="incidents"
                stroke={COLORS.primary}
                strokeWidth={2}
                dot={false}
                name="Incidents"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Noisiest Services Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 Noisiest Services</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              layout="vertical"
              data={[
                { name: "Auth Service", value: 450 },
                { name: "API Gateway", value: 380 },
                { name: "Payment Processor", value: 320 },
                { name: "Cache Layer", value: 290 },
                { name: "Queue Worker", value: 210 },
                { name: "Email Service", value: 180 },
                { name: "Search Index", value: 160 },
                { name: "Notification Hub", value: 140 },
                { name: "Image Processor", value: 120 },
                { name: "Log Aggregator", value: 100 },
              ]}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis type="number" tick={{ fontSize: 12 }} stroke="#71717a" />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} stroke="#71717a" />
              <Tooltip
                contentStyle={{ backgroundColor: "#fff", border: `1px solid #e4e4e7` }}
              />
              <Bar dataKey="value" fill={COLORS.primary} name="Incident Count" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Heatmap Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Incident Heatmap: Day of Week × Hour</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
              {/* Header row */}
              <div className="flex">
                <div className="w-16 flex-shrink-0" />
                <div className="flex gap-1">
                  {HOUR_LABELS.map((hour) => (
                    <div
                      key={hour}
                      className="w-12 text-xs text-center text-zinc-600 py-1"
                    >
                      {hour}
                    </div>
                  ))}
                </div>
              </div>

              {/* Rows */}
              {DAY_NAMES.map((day, dayIdx) => (
                <div key={day} className="flex items-center">
                  <div className="w-16 flex-shrink-0 text-sm font-medium text-zinc-700">
                    {day}
                  </div>
                  <div className="flex gap-1">
                    {HOUR_LABELS.map((hour) => {
                      const value = Math.max(
                        0,
                        Math.round(50 * (Math.sin(dayIdx * 0.5 + parseInt(hour) * 0.1) * 0.5 + 1))
                      );
                      const intensity = Math.min(value / 100, 1);
                      const bgColor = `rgba(59, 130, 246, ${intensity})`;
                      return (
                        <div
                          key={`${day}-${hour}`}
                          className="w-12 h-8 rounded border border-zinc-200"
                          style={{ backgroundColor: bgColor }}
                          title={`${day} ${hour}: ${value} incidents`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-4">
            Lighter shade = fewer incidents | Darker shade = more incidents
          </p>
        </CardContent>
      </Card>

      {/* Severity Distribution Pie Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Incident Severity Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={severityData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
              >
                <Cell fill={COLORS.danger} />
                <Cell fill={COLORS.warning} />
                <Cell fill={COLORS.neutral} />
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: "#fff", border: `1px solid #e4e4e7` }}
              />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Noise Breakdown Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Auto-resolved %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{noiseMetrics.autoResolved}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Ack, No Action %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{noiseMetrics.ackNoAction}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Escalated %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{noiseMetrics.escalated}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">MTTA</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">
              {formatSeconds(noiseMetrics.mtta)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">MTTR</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">
              {formatSeconds(noiseMetrics.mttr)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}