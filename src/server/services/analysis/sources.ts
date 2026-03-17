export interface SourceAnalysis {
  sources: { sourceName: string; integrationType: string; incidentCount: number; percentOfTotal: number }[]
  totalFromMonitoring: number
  totalFromApi: number
  totalFromEmail: number
  totalFromOrchestration: number
  preFilteredAssessment: string // "heavy filtering detected" / "minimal filtering" / "unknown"
  criticalOnlyDetection: boolean
  orchestrationRouting?: {
    orchestrationName: string
    routedServiceCount: number
    ruleCount: number
    recommendation: string
  }[]
}

// Generic/system integration names that don't represent a real monitoring source
const GENERIC_INTEGRATION_NAMES = new Set([
  'change events',
  'events api v2',
  'events api',
  'email',
  'pagerduty',
  'unknown',
])

export function analyzeSources(
  incidents: any[],
  services: any[],
  integrations: Map<string, any[]>,
  serviceToOrchestrations?: Map<string, Array<{ eoName: string; eoPdId: string; ruleCount: number; eoIntegrationNames?: string[] }>>
): SourceAnalysis {
  const sourceMap = new Map<string, number>()
  let totalFromMonitoring = 0
  let totalFromApi = 0
  let totalFromEmail = 0
  let totalFromOrchestration = 0

  // Build set of services that are routed to via Event Orchestration
  const eoRoutedServices = new Set<string>()
  const serviceToEoInfo = new Map<string, { eoName: string; eoIntegrationNames: string[] }>()
  if (serviceToOrchestrations) {
    serviceToOrchestrations.forEach((eos, serviceId) => {
      eoRoutedServices.add(serviceId)
      if (eos.length > 0) {
        serviceToEoInfo.set(serviceId, {
          eoName: eos[0].eoName,
          eoIntegrationNames: eos[0].eoIntegrationNames || [],
        })
      }
    })
  }

  // Helper: find the best real vendor integration for a service (skip generics)
  function getRealVendorIntegration(serviceId: string): string | null {
    const intList = integrations.get(serviceId) || []
    for (const integration of intList) {
      const vendorName = integration.vendor?.name || ''
      if (vendorName && !GENERIC_INTEGRATION_NAMES.has(vendorName.toLowerCase())) {
        return vendorName
      }
      // Also check integration name itself
      const intName = integration.name || ''
      if (intName && !GENERIC_INTEGRATION_NAMES.has(intName.toLowerCase())) {
        return intName
      }
    }
    return null
  }

  // Helper: extract the real source from the incident's trigger log entry channel
  function getSourceFromChannel(incident: any): string | null {
    const channel = incident.first_trigger_log_entry?.channel
    if (!channel) return null

    // CEF (Common Event Format) source_component is the most reliable field
    // This is set by the monitoring tool when sending events via Events API v2
    const cefSource = channel.cef_details?.source_component
    if (cefSource && !GENERIC_INTEGRATION_NAMES.has(cefSource.toLowerCase())) {
      return cefSource
    }

    // Some integrations set a direct source field on the channel
    const directSource = channel.source
    if (directSource && !GENERIC_INTEGRATION_NAMES.has(directSource.toLowerCase())) {
      return directSource
    }

    // Check channel details for source info
    const detailSource = channel.details?.source
    if (detailSource && !GENERIC_INTEGRATION_NAMES.has(detailSource.toLowerCase())) {
      return detailSource
    }

    return null
  }

  // Analyze incidents to identify sources
  incidents.forEach((incident: any) => {
    const serviceId = incident.service?.id || 'unknown'
    let sourceName = 'Unknown'
    let sourceType = 'unknown'

    const channelType = incident.first_trigger_log_entry?.channel?.type
    const channelSource = getSourceFromChannel(incident)

    // Priority 1: Real source from incident payload channel data (most reliable)
    // The .source / .cef_details.source_component field contains the actual monitoring tool name
    if (channelSource) {
      sourceName = channelSource
      sourceType = 'monitoring'
      totalFromMonitoring++
      // If this service is also EO-routed, annotate that in the source name
      if (eoRoutedServices.has(serviceId)) {
        const eoInfo = serviceToEoInfo.get(serviceId)
        const eoName = eoInfo?.eoName || 'Event Orchestration'
        sourceName = `${channelSource} (via ${eoName})`
        sourceType = 'event_orchestration'
        totalFromOrchestration++
        totalFromMonitoring-- // undo the monitoring count
      }
    }
    // Priority 2: EO-routed service but no channel source available
    else if (eoRoutedServices.has(serviceId)) {
      const eoInfo = serviceToEoInfo.get(serviceId)
      const eoName = eoInfo?.eoName || 'Global Event Orchestration'
      if (eoInfo?.eoIntegrationNames && eoInfo.eoIntegrationNames.length > 0) {
        sourceName = `${eoInfo.eoIntegrationNames[0]} (via ${eoName})`
      } else {
        sourceName = eoName
      }
      sourceType = 'event_orchestration'
      totalFromOrchestration++
    }
    // Priority 3: API-created incidents (explicit API channel)
    else if (channelType === 'api') {
      sourceType = 'api'
      sourceName = 'Direct API'
      totalFromApi++
    }
    // Priority 4: Email-created incidents
    else if (
      channelType === 'email' ||
      incident.channels?.some((ch: any) => ch.type === 'email_log_entry')
    ) {
      sourceType = 'email'
      sourceName = 'Email Integration'
      totalFromEmail++
    }
    // Priority 5: Events API v2 / Events API channel type — check for vendor on service
    else if (channelType === 'events_api_v2' || channelType === 'events_api') {
      const realVendor = getRealVendorIntegration(serviceId)
      if (realVendor) {
        sourceName = realVendor
        sourceType = 'monitoring'
        totalFromMonitoring++
      } else {
        sourceType = 'events_api'
        sourceName = 'Events API'
        totalFromApi++
      }
    }
    // Priority 6: Real vendor integrations on the service (not generic ones)
    else {
      const realVendor = getRealVendorIntegration(serviceId)
      if (realVendor) {
        sourceName = realVendor
        sourceType = 'monitoring'
        totalFromMonitoring++
      } else {
        sourceType = 'monitoring'
        sourceName = 'Monitoring Integration'
        totalFromMonitoring++
      }
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

  // Build orchestration routing recommendations
  const orchestrationRouting: SourceAnalysis['orchestrationRouting'] = []
  if (serviceToOrchestrations) {
    const eoMap = new Map<string, { name: string; routedServices: Set<string>; ruleCount: number }>()
    serviceToOrchestrations.forEach((eos, serviceId) => {
      for (const eo of eos) {
        const existing = eoMap.get(eo.eoPdId) || { name: eo.eoName, routedServices: new Set<string>(), ruleCount: eo.ruleCount }
        existing.routedServices.add(serviceId)
        eoMap.set(eo.eoPdId, existing)
      }
    })

    eoMap.forEach((eo) => {
      orchestrationRouting!.push({
        orchestrationName: eo.name,
        routedServiceCount: eo.routedServices.size,
        ruleCount: eo.ruleCount,
        recommendation: `Create ${eo.routedServices.size} alert routing rule${eo.routedServices.size !== 1 ? 's' : ''} in incident.io — one per service — matching on event payload field (e.g. event.custom_details.service_name) to replace this Global Event Orchestration dynamic routing.`,
      })
    })
  }

  return {
    sources,
    totalFromMonitoring,
    totalFromApi,
    totalFromEmail,
    totalFromOrchestration,
    preFilteredAssessment,
    criticalOnlyDetection,
    orchestrationRouting: orchestrationRouting.length > 0 ? orchestrationRouting : undefined,
  }
}
