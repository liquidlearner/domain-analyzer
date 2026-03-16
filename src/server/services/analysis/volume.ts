import type { PDIncident, PDService } from '@/server/services/pd/types'

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
}

export function analyzeVolume(
  incidents: any[],
  services: any[]
): VolumeAnalysis {
  const serviceMap = new Map<string, string>()
  services.forEach((svc: any) => {
    serviceMap.set(svc.id, svc.name || 'Unknown')
  })

  // Count by service
  const incidentsByService = new Map<string, number>()
  const incidentsByDay = new Map<string, number>()
  const incidentsByHour = new Map<number, number>()
  const incidentsByDayOfWeek = new Map<number, number>()
  const heatmapData = new Map<string, number>()
  const severityDistribution = new Map<string, number>()

  incidents.forEach((incident: any) => {
    const serviceId = incident.service?.id || 'unknown'
    const severity = incident.urgency || 'unknown'
    const createdAt = incident.created_at ? new Date(incident.created_at) : null

    // Service count
    incidentsByService.set(serviceId, (incidentsByService.get(serviceId) ?? 0) + 1)

    // Severity distribution
    severityDistribution.set(
      severity,
      (severityDistribution.get(severity) ?? 0) + 1
    )

    if (createdAt && !isNaN(createdAt.getTime())) {
      // Day aggregation (YYYY-MM-DD)
      const dateKey = createdAt.toISOString().split('T')[0]
      incidentsByDay.set(dateKey, (incidentsByDay.get(dateKey) ?? 0) + 1)

      // Hour aggregation (0-23)
      const hour = createdAt.getUTCHours()
      incidentsByHour.set(hour, (incidentsByHour.get(hour) ?? 0) + 1)

      // Day of week (0=Sun, 6=Sat)
      const dayOfWeek = createdAt.getUTCDay()
      incidentsByDayOfWeek.set(
        dayOfWeek,
        (incidentsByDayOfWeek.get(dayOfWeek) ?? 0) + 1
      )

      // Heatmap: day of week × hour
      const heatmapKey = `${dayOfWeek}:${hour}`
      heatmapData.set(heatmapKey, (heatmapData.get(heatmapKey) ?? 0) + 1)
    }
  })

  // Convert maps to arrays and sort
  const incidentsByServiceArray = Array.from(incidentsByService.entries())
    .map(([serviceId, count]) => ({
      serviceId,
      serviceName: serviceMap.get(serviceId) || 'Unknown',
      count,
    }))
    .sort((a, b) => b.count - a.count)

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

  const severityDistributionArray = Array.from(
    severityDistribution.entries()
  ).map(([severity, count]) => ({ severity, count }))

  return {
    totalIncidents: incidents.length,
    totalAlerts: incidents.length, // Assuming 1:1 for now; adjust if different
    incidentsByService: incidentsByServiceArray,
    incidentsByDay: incidentsByDayArray,
    incidentsByHour: incidentsByHourArray,
    incidentsByDayOfWeek: incidentsByDayOfWeekArray,
    heatmapData: heatmapArray,
    severityDistribution: severityDistributionArray,
    topNoisiest,
  }
}
