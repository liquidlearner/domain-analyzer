export interface SourceAnalysis {
  sources: { sourceName: string; integrationType: string; incidentCount: number; percentOfTotal: number }[]
  totalFromMonitoring: number
  totalFromApi: number
  totalFromEmail: number
  preFilteredAssessment: string // "heavy filtering detected" / "minimal filtering" / "unknown"
  criticalOnlyDetection: boolean
}

export function analyzeSources(
  incidents: any[],
  services: any[],
  integrations: Map<string, any[]>
): SourceAnalysis {
  const sourceMap = new Map<string, number>()
  const integrationTypeMap = new Map<string, string>()
  let totalFromMonitoring = 0
  let totalFromApi = 0
  let totalFromEmail = 0

  // Build integration type index
  integrations.forEach((intList, serviceId) => {
    intList.forEach((integration: any) => {
      const intKey = `${serviceId}:${integration.id}`
      const vendorName = integration.vendor?.name || integration.name || 'Unknown'
      integrationTypeMap.set(intKey, vendorName)
    })
  })

  // Analyze incidents to identify sources
  incidents.forEach((incident: any) => {
    const serviceId = incident.service?.id || 'unknown'
    const integrations_ = integrations.get(serviceId) || []
    let sourceName = 'Unknown'
    let sourceType = 'unknown'

    // Try to identify source from incident details
    if (
      incident.incident_key &&
      incident.incident_key.includes('api') &&
      incident.incident_key.includes('token')
    ) {
      sourceType = 'api'
      sourceName = 'API'
      totalFromApi++
    } else if (
      incident.channels?.some((ch: any) => ch.type === 'email_log_entry')
    ) {
      sourceType = 'email'
      sourceName = 'Email'
      totalFromEmail++
    } else if (integrations_.length > 0) {
      // Try to match based on integration
      const integrationName =
        integrations_[0]?.vendor?.name || integrations_[0]?.name || 'Monitoring'
      sourceName = integrationName
      sourceType = 'monitoring'
      totalFromMonitoring++
    } else {
      sourceType = 'monitoring'
      sourceName = 'Monitoring Integration'
      totalFromMonitoring++
    }

    const key = `${sourceName}:${sourceType}`
    sourceMap.set(key, (sourceMap.get(key) ?? 0) + 1)
  })

  // Convert to array and calculate percentages
  const totalIncidents = incidents.length
  const sources = Array.from(sourceMap.entries())
    .map(([key, count]) => {
      const [sourceName, integrationType] = key.split(':')
      return {
        sourceName,
        integrationType,
        incidentCount: count,
        percentOfTotal:
          totalIncidents > 0 ? (count / totalIncidents) * 100 : 0,
      }
    })
    .sort((a, b) => b.incidentCount - a.incidentCount)

  // Detect if filtering is happening
  let preFilteredAssessment = 'unknown'
  if (totalIncidents > 500) {
    // Large incident volume likely means filtering
    preFilteredAssessment = 'heavy filtering detected'
  } else if (totalIncidents > 100) {
    preFilteredAssessment = 'minimal filtering'
  } else if (totalIncidents > 0) {
    preFilteredAssessment = 'heavy filtering detected'
  }

  // Detect if only critical incidents are being pulled
  const criticalIncidents = incidents.filter(
    (i: any) => i.urgency === 'high'
  ).length
  const criticalOnlyDetection =
    totalIncidents > 0 && criticalIncidents / totalIncidents > 0.95

  return {
    sources,
    totalFromMonitoring,
    totalFromApi,
    totalFromEmail,
    preFilteredAssessment,
    criticalOnlyDetection,
  }
}
