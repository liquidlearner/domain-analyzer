import type { PDIncident, PDService, PDAnalyticsServiceMetric } from '@/server/services/pd/types'

export interface VolumeAnalysis {
  totalIncidents: number
  totalAlerts: number
  incidentsByService: { serviceId: string; serviceName: string; count: number }[]
  incidentsByDay: { date: string; count: number }[]
  incidentsByHour: { hour: number; count: number }[] // 0-23
  incidentsByDayOfWeek: { day: number; count: number }[] // 0=Sun, 6=Sat
  heatmapData: { day: number; hour: number; count: number }[] // for day-of-week × hour heatmap
  severityDistribution: { severity: string; count: number }[]
  topNoisiest: { serviceId: string; serviceName: string; count: number }[] // top 10
  analyticsAvailable: boolean
}

export function analyzeVolume(
  incidents: any[],
  services: any[],
  analyticsMetrics: PDAnalyticsServiceMetric[] = []
): VolumeAnalysis {
  const serviceMap = new Map<string, string>()
  services.forEach((svc: any) => {
    serviceMap.set(svc.id, svc.name || 'Unknown')
  })

  // Time-pattern aggregations always come from incident timestamps
  // (analytics API doesn't provide per-hour/per-day-of-week breakdowns)
  const incidentsByDay = new Map<string, number>()
  const incidentsByHour = new Map<number, number>()
  const incidentsByDayOfWeek = new Map<number, number>()
  const heatmapData = new Map<string, number>()
  const severityDistribution = new Map<string, number>()

  incidents.forEach((incident: any) => {
    const severity = incident.urgency || 'unknown'
    const createdAt = incident.created_at ? new Date(incident.created_at) : null

    // Severity distribution
    severityDistribution.set(severity, (severityDistribution.get(severity) ?? 0) + 1)

    if (createdAt && !isNaN(createdAt.getTime())) {
      // Day aggregation (YYYY-MM-DD)
      const dateKey = createdAt.toISOString().split('T')[0]
      incidentsByDay.set(dateKey, (incidentsByDay.get(dateKey) ?? 0) + 1)

      // Hour aggregation (0-23)
      const hour = createdAt.getUTCHours()
      incidentsByHour.set(hour, (incidentsByHour.get(hour) ?? 0) + 1)

      // Day of week (0=Sun, 6=Sat)
      const dayOfWeek = createdAt.getUTCDay()
      incidentsByDayOfWeek.set(dayOfWeek, (incidentsByDayOfWeek.get(dayOfWeek) ?? 0) + 1)

      // Heatmap: day of week × hour
      const heatmapKey = `${dayOfWeek}:${hour}`
      heatmapData.set(heatmapKey, (heatmapData.get(heatmapKey) ?? 0) + 1)
    }
  })

  // ── Per-service counts: prefer analytics API (accurate) over incident sample ──
  let incidentsByServiceArray: { serviceId: string; serviceName: string; count: number }[]
  let totalIncidents: number
  const analyticsAvailable = analyticsMetrics.length > 0

  if (analyticsAvailable) {
    // Use accurate aggregate counts from analytics API
    incidentsByServiceArray = analyticsMetrics
      .map((m) => ({
        serviceId: m.service_id,
        serviceName: m.service_name || serviceMap.get(m.service_id) || 'Unknown',
        count: m.total_incident_count,
      }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
    totalIncidents = analyticsMetrics.reduce((sum, m) => sum + m.total_incident_count, 0)
  } else {
    // Fall back to counting from the incident sample
    const incidentsByService = new Map<string, number>()
    incidents.forEach((incident: any) => {
      const serviceId = incident.service?.id || 'unknown'
      incidentsByService.set(serviceId, (incidentsByService.get(serviceId) ?? 0) + 1)
    })
    incidentsByServiceArray = Array.from(incidentsByService.entries())
      .map(([serviceId, count]) => ({
        serviceId,
        serviceName: serviceMap.get(serviceId) || 'Unknown',
        count,
      }))
      .sort((a, b) => b.count - a.count)
    totalIncidents = incidents.length
  }

  const topNoisiest = incidentsByServiceArray.slice(0, 10)

  const incidentsByDayArray = Array.from(incidentsByDay.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const incidentsByHourArray = Array.from(incidentsByHour.entries())
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour - b.hour)

  const incidentsByDayOfWeekArray = Array.from(incidentsByDayOfWeek.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day - b.day)

  const heatmapArray = Array.from(heatmapData.entries())
    .map(([key, count]) => {
      const [day, hour] = key.split(':').map(Number)
      return { day, hour, count }
    })
    .sort((a, b) => (a.day - b.day) * 24 + (a.hour - b.hour))

  const severityDistributionArray = Array.from(severityDistribution.entries()).map(
    ([severity, count]) => ({ severity, count })
  )

  return {
    totalIncidents,
    totalAlerts: totalIncidents, // 1:1 assumption
    incidentsByService: incidentsByServiceArray,
    incidentsByDay: incidentsByDayArray,
    incidentsByHour: incidentsByHourArray,
    incidentsByDayOfWeek: incidentsByDayOfWeekArray,
    heatmapData: heatmapArray,
    severityDistribution: severityDistributionArray,
    topNoisiest,
    analyticsAvailable,
  }
}
