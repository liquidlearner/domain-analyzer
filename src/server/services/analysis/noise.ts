export interface NoiseAnalysis {
  autoResolvedPercent: number // resolved with no human ack
  ackNoActionPercent: number // acknowledged but no further action
  escalatedPercent: number // escalated to next level
  meanTimeToAck: number // seconds
  meanTimeToResolve: number // seconds
  transientAlerts: { serviceId: string; serviceName: string; count: number; avgDurationMinutes: number }[]
  overallNoiseRatio: number // 0-1, percentage that's noise
  logEntriesAvailable: boolean // whether log entry data was available for accurate noise detection
  apiResolvedPercent: number // % of resolved incidents resolved via API (not human)
  apiResolvedCount: number // raw count
  totalResolved: number // total resolved incidents
}

export function analyzeNoise(
  incidents: any[],
  logEntries: any[]
): NoiseAnalysis {
  let autoResolvedCount = 0
  let ackNoActionCount = 0
  let escalatedCount = 0
  let apiResolvedCount = 0
  let totalResolved = 0
  let ackTimes: number[] = []
  let resolveTimes: number[] = []
  let transientAlertsMap = new Map<string, { count: number; durations: number[] }>()

  const hasLogEntries = logEntries.length > 0

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

    // Track resolve time and API resolves
    if (isResolved) {
      totalResolved++
      if (resolvedAt > createdAt) {
        resolveTimes.push(resolvedAt - createdAt)
      }
      // Detect API-resolved incidents: last_status_change_by is a service (API/integration)
      // rather than a user. This indicates automation or an external tool resolved the incident.
      const resolvedByType = incident.last_status_change_by?.type || ''
      const resolvedBySummary = (incident.last_status_change_by?.summary || '').toLowerCase()
      const isApiResolve =
        resolvedByType === 'service_reference' ||
        resolvedByType === 'integration_reference' ||
        resolvedByType === 'api_token_reference' ||
        resolvedBySummary.includes('api') ||
        resolvedBySummary.includes('automation') ||
        resolvedBySummary.includes('integration')
      if (isApiResolve) {
        apiResolvedCount++
      }
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
    if (isResolved && !ackLog && hasLogEntries) {
      // Resolved without acknowledgment (confirmed via log entries) = auto-resolved
      autoResolvedCount++
    } else if (isResolved && !hasLogEntries) {
      // Without log entries, use time-based heuristic: resolve < 60s = likely automated
      if (resolvedAt > createdAt && (resolvedAt - createdAt) < 60000) {
        autoResolvedCount++
      }
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

  const apiResolvedPercent =
    totalResolved > 0 ? (apiResolvedCount / totalResolved) * 100 : 0

  return {
    autoResolvedPercent,
    ackNoActionPercent,
    escalatedPercent,
    meanTimeToAck,
    meanTimeToResolve,
    transientAlerts,
    overallNoiseRatio,
    logEntriesAvailable: hasLogEntries,
    apiResolvedPercent,
    apiResolvedCount,
    totalResolved,
  }
}
