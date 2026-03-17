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

/* eslint-disable @typescript-eslint/no-explicit-any */
interface VolumeNoiseTabProps {
  evaluation: any;
  analysisData?: any;
}

const COLORS = {
  primary: "#F25533",
  success: "#22c55e",
  warning: "#eab308",
  danger: "#ef4444",
  neutral: "#71717a",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}:00`);

export default function VolumeNoiseTab({ evaluation, analysisData }: VolumeNoiseTabProps) {
  const volume = analysisData?.volume;
  const noise = analysisData?.noise;

  const { volumeData, noisiestData, heatmapGrid, severityData, noiseMetrics } = useMemo(() => {
    // Volume over time — use real incidentsByDay data
    const volumeData = (volume?.incidentsByDay || []).map((d: any) => ({
      date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      incidents: d.count,
    }));

    // Top noisiest services — real data
    const noisiestData = (volume?.topNoisiest || []).map((s: any) => ({
      name: s.serviceName || "Unknown",
      value: s.count,
    }));

    // Build heatmap grid from real data
    const heatmapMap = new Map<string, number>();
    (volume?.heatmapData || []).forEach((h: any) => {
      heatmapMap.set(`${h.day}:${h.hour}`, h.count);
    });
    // Find max for intensity scaling
    let maxHeat = 1;
    heatmapMap.forEach(v => { if (v > maxHeat) maxHeat = v; });
    const heatmapGrid = DAY_NAMES.map((_, dayIdx) =>
      HOUR_LABELS.map((_, hourIdx) => ({
        count: heatmapMap.get(`${dayIdx}:${hourIdx}`) || 0,
        intensity: (heatmapMap.get(`${dayIdx}:${hourIdx}`) || 0) / maxHeat,
      }))
    );

    // Severity distribution — real data
    const severityData = (volume?.severityDistribution || []).map((s: any) => ({
      name: s.severity === "high" ? "High" : s.severity === "low" ? "Low" : "Medium",
      value: s.count,
    }));

    // Noise metrics — from real patternsJson data
    const noiseMetrics = {
      autoResolved: noise?.autoResolvedPercent ?? 0,
      ackNoAction: noise?.ackNoActionPercent ?? 0,
      escalated: noise?.escalatedPercent ?? 0,
      mtta: noise?.meanTimeToAck ?? 0,
      mttr: noise?.meanTimeToResolve ?? 0,
      apiResolved: noise?.apiResolvedPercent ?? 0,
      apiResolvedCount: noise?.apiResolvedCount ?? 0,
      totalResolved: noise?.totalResolved ?? 0,
    };

    return { volumeData, noisiestData, heatmapGrid, severityData, noiseMetrics };
  }, [volume, noise]);

  const formatSeconds = (seconds: number) => {
    if (seconds === 0) return "N/A";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return `${Math.round(seconds)}s`;
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
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

  return (
    <div className="space-y-6">
      {/* Volume Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Incident Volume Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          {volumeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#71717a" />
                <YAxis tick={{ fontSize: 12 }} stroke="#71717a" />
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e4e4e7" }} />
                <Legend />
                <Line type="monotone" dataKey="incidents" stroke={COLORS.primary} strokeWidth={2} dot={volumeData.length < 60} name="Incidents" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-500 py-8 text-center">No incident volume data available</p>
          )}
        </CardContent>
      </Card>

      {/* Top Noisiest Services */}
      <Card>
        <CardHeader>
          <CardTitle>Top {noisiestData.length} Noisiest Services</CardTitle>
        </CardHeader>
        <CardContent>
          {noisiestData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, noisiestData.length * 35)}>
              <BarChart layout="vertical" data={noisiestData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke="#71717a" />
                <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 11 }} stroke="#71717a" />
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e4e4e7" }} />
                <Bar dataKey="value" fill={COLORS.primary} name="Incident Count" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-500 py-8 text-center">No service data available</p>
          )}
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
              <div className="flex">
                <div className="w-16 flex-shrink-0" />
                <div className="flex gap-1">
                  {HOUR_LABELS.filter((_, i) => i % 3 === 0).map((hour) => (
                    <div key={hour} className="w-10 text-xs text-center text-zinc-600 py-1">{hour}</div>
                  ))}
                </div>
              </div>
              {DAY_NAMES.map((day, dayIdx) => (
                <div key={day} className="flex items-center">
                  <div className="w-16 flex-shrink-0 text-sm font-medium text-zinc-700">{day}</div>
                  <div className="flex gap-1">
                    {HOUR_LABELS.filter((_, i) => i % 3 === 0).map((_, hourGroupIdx) => {
                      const hourIdx = hourGroupIdx * 3;
                      // Sum the 3-hour block
                      const count = (heatmapGrid[dayIdx]?.[hourIdx]?.count || 0)
                        + (heatmapGrid[dayIdx]?.[hourIdx + 1]?.count || 0)
                        + (heatmapGrid[dayIdx]?.[hourIdx + 2]?.count || 0);
                      const maxBlock = Math.max(
                        ...heatmapGrid.flat().reduce((arr: number[], _, i, grid) => {
                          if (i % 3 === 0) arr.push((grid[i]?.count || 0) + (grid[i+1]?.count || 0) + (grid[i+2]?.count || 0));
                          return arr;
                        }, [1])
                      );
                      const intensity = maxBlock > 0 ? Math.min(count / maxBlock, 1) : 0;
                      return (
                        <div
                          key={`${day}-${hourIdx}`}
                          className="w-10 h-8 rounded border border-zinc-200"
                          style={{ backgroundColor: `rgba(242, 85, 51, ${intensity * 0.85})` }}
                          title={`${day} ${HOUR_LABELS[hourIdx]}: ${count} incidents`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-4">Lighter = fewer incidents | Darker = more incidents (3-hour blocks)</p>
        </CardContent>
      </Card>

      {/* Severity Distribution */}
      {severityData.length > 0 && (
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
                  {severityData.map((entry: any, idx: number) => (
                    <Cell
                      key={idx}
                      fill={
                        entry.name === "High" ? COLORS.danger
                        : entry.name === "Low" ? COLORS.neutral
                        : COLORS.warning
                      }
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e4e4e7" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Noise Breakdown Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Auto-resolved %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{noiseMetrics.autoResolved.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Ack, No Action %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{noiseMetrics.ackNoAction.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">Escalated %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{noiseMetrics.escalated.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">MTTA</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{formatSeconds(noiseMetrics.mtta)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">MTTR</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{formatSeconds(noiseMetrics.mttr)}</p>
          </CardContent>
        </Card>
        <Card className={noiseMetrics.apiResolved > 50 ? "border-amber-300 bg-amber-50" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-medium text-zinc-600">API-Resolved %</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-zinc-900">{noiseMetrics.apiResolved.toFixed(1)}%</p>
            <p className="text-xs text-zinc-500 mt-1">
              {noiseMetrics.apiResolvedCount} of {noiseMetrics.totalResolved} resolved
            </p>
            {noiseMetrics.apiResolved > 75 && (
              <p className="text-xs text-amber-700 mt-2 font-medium">
                External automation likely handling resolution
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
