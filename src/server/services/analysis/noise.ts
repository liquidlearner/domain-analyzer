export interface NoiseAnalysis {
  autoResolvedPercent: number // resolved with no human ack
  ackNoActionPercent: number // acknowledged but no further action
  escalatedPercent: number // escalated to next level
  meanTimeToAck: number // seconds
  meanTimeToResolve: number // seconds
  transientAlerts: { serviceId: string; serviceName: string; count: number; avgDurationMinutes: number }[]
  overallNoiseRatio: number // 0-1, percentage that's noise
}

export function analyzeNoise(
  incidents: any[],
  logEntries: any[]
): NoiseAnalysis {
  let autoResolvedCount = 0
  let ackNoActionCount = 0
  let escalatedCount = 0
  let ackTimes: number[] = []
  let resolveTimes: number[] = []
  let transientAlertsMap = new Map<string, { count: number; durations: number[] }>()

  // Build log entry map for quick lookup
  const logsByIncident = new Map<string, any[]>()
  logEntries.forEach((log: any) => {
    const incidentId = log.incident?.id || log.incident_reference?.id
    if (incidentId) {
      if (!logsByIncident.has(incidentId)) {
        logsByIncident.set(incidentId, [])
      }
      logsByIncident.get(incidentId)!.push(log)
    }
  })

  incidents.forEach((incident: any) => {
    const createdAt = incident.created_at ? new Date(incident.created_at).getTime() : 0
    const resolvedAt = incident.last_status_change_at
      ? new Date(incident.last_status_change_at).getTime()
      : 0
    const isResolved = incident.status === 'resolved'
    const isAcknowledged = incident.status === 'acknowledged'
    const incidentId = incident.id

    // Track resolve time
    if (isResolved && resolvedAt > createdAt) {
      resolveTimes.push(resolvedAt - createdAt)
    }

    // Get log entries for this incident
    const logs = logsByIncident.get(incidentId) || []

    // Check for ack time
    const ackLog = logs.find((log: any) =>
      log.type?.includes('incident.acknowledged')
    )
    if (ackLog) {
      const ackTime = new Date(ackLog.created_at).getTime()
      if (ackTime > createdAt) {
        ackTimes.push(ackTime - createdAt)
      }
    }

    // Categorize noise
    if (isResolved && !ackLog) {
      // Resolved without acknowledgment = auto-resolved
      autoResolvedCount++
    } else if (isAcknowledged && logs.length === 1) {
      // Acknowledged with no further action
      ackNoActionCount++
    }

    // Check for escalation
    const escalationLog = logs.find((log: any) =>
      log.type?.includes('incident.escalated')
    )
    if (escalationLog) {
      escalatedCount++
    }

    // Track transient alerts (resolved within 10 minutes)
    if (isResolved && resolvedAt > createdAt) {
      const durationMinutes = (resolvedAt - createdAt) / (1000 * 60)
      if (durationMinutes < 10) {
        const serviceId = incident.service?.id || 'unknown'
        const serviceName = incident.service?.name || 'Unknown'
        const key = `${serviceId}:${serviceName}`

        if (!transientAlertsMap.has(key)) {
          transientAlertsMap.set(key, { count: 0, durations: [] })
        }
        const item = transientAlertsMap.get(key)!
        item.count++
        item.durations.push(durationMinutes)
      }
    }
  })

  const totalIncidents = incidents.length
  const autoResolvedPercent =
    totalIncidents > 0 ? (autoResolvedCount / totalIncidents) * 100 : 0
  const ackNoActionPercent =
    totalIncidents > 0 ? (ackNoActionCount / totalIncidents) * 100 : 0
  const escalatedPercent =
    totalIncidents > 0 ? (escalatedCount / totalIncidents) * 100 : 0

  // Calculate mean times
  const meanTimeToAck =
    ackTimes.length > 0
      ? ackTimes.reduce((a, b) => a + b, 0) / ackTimes.length / 1000
      : 0
  const meanTimeToResolve =
    resolveTimes.length > 0
      ? resolveTimes.reduce((a, b) => a + b, 0) / resolveTimes.length / 1000
      : 0

  // Build transient alerts array
  const transientAlerts = Array.from(transientAlertsMap.entries()).map(
    ([key, data]) => {
      const [serviceId, serviceName] = key.split(':')
      const avgDurationMinutes =
        data.durations.length > 0
          ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length
          : 0
      return {
        serviceId,
        serviceName,
        count: data.count,
        avgDurationMinutes,
      }
    }
  )

  // Overall noise ratio: % of incidents that are likely noise
  const noiseIndicators = autoResolvedCount + ackNoActionCount
  const overallNoiseRatio =
    totalIncidents > 0 ? noiseIndicators / totalIncidents : 0

  return {
    autoResolvedPercent,
    ackNoActionPercent,
    escalatedPercent,
    meanTimeToAck,
    meanTimeToResolve,
    transientAlerts,
    overallNoiseRatio,
  }
}
