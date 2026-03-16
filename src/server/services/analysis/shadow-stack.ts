export interface ShadowSignal {
  type: 'api_consumer' | 'webhook_destination' | 'auto_ack' | 'api_created_incident' | 'enrichment_middleware' | 'custom_extension'
  confidence: 'high' | 'medium' | 'low'
  evidence: string
  description: string
  serviceId?: string
  serviceName?: string
}

export interface ShadowStackAnalysis {
  signals: ShadowSignal[]
  apiConsumerCount: number
  webhookDestinationCount: number
  automationPatternCount: number
  estimatedMaintenanceBurden: 'low' | 'medium' | 'high'
}

export function analyzeShadowStack(
  incidents: any[],
  logEntries: any[],
  services: any[],
  integrations: Map<string, any[]>
): ShadowStackAnalysis {
  const signals: ShadowSignal[] = []
  let apiConsumerCount = 0
  let webhookDestinationCount = 0
  let automationPatternCount = 0

  const serviceMap = new Map<string, string>()
  services.forEach((svc: any) => {
    serviceMap.set(svc.id, svc.name || 'Unknown')
  })

  // Detect API consumers from log entries
  logEntries.forEach((log: any) => {
    if (log.agent?.type === 'api_token_reference') {
      apiConsumerCount++
      const incidentId = log.incident?.id
      const incident = incidents.find((i: any) => i.id === incidentId)
      const serviceId = incident?.service?.id || 'unknown'
      const serviceName = serviceMap.get(serviceId) || 'Unknown'

      signals.push({
        type: 'api_consumer',
        confidence: 'high',
        evidence: `Log entry ${log.id} shows API token reference`,
        description: `API integration detected on service ${serviceName}`,
        serviceId,
        serviceName,
      })
    }

    // Detect auto-ack patterns (incident resolved within 10 seconds)
    if (log.type?.includes('incident.acknowledged')) {
      const incidentId = log.incident?.id
      const incident = incidents.find((i: any) => i.id === incidentId)
      if (incident?.created_at && log.created_at) {
        const createdMs = new Date(incident.created_at).getTime()
        const ackMs = new Date(log.created_at).getTime()
        const diffSeconds = (ackMs - createdMs) / 1000

        if (diffSeconds < 10 && diffSeconds >= 0) {
          automationPatternCount++
          const serviceId = incident.service?.id || 'unknown'
          const serviceName = serviceMap.get(serviceId) || 'Unknown'

          signals.push({
            type: 'auto_ack',
            confidence: 'high',
            evidence: `Acknowledged in ${diffSeconds.toFixed(1)}s`,
            description: `Auto-responder detected on ${serviceName}`,
            serviceId,
            serviceName,
          })
        }
      }
    }

    // Detect API-created incidents
    if (
      log.type?.includes('incident.triggered') &&
      log.agent?.type === 'service_reference'
    ) {
      const incidentId = log.incident?.id
      const incident = incidents.find((i: any) => i.id === incidentId)
      const serviceId = incident?.service?.id || 'unknown'
      const serviceName = serviceMap.get(serviceId) || 'Unknown'

      if (!signals.some((s) => s.type === 'api_created_incident' && s.serviceId === serviceId)) {
        signals.push({
          type: 'api_created_incident',
          confidence: 'medium',
          evidence: `Service-triggered incident detected`,
          description: `Custom incident creation logic on ${serviceName}`,
          serviceId,
          serviceName,
        })
      }
    }

    // Detect enrichment middleware (notes added by API)
    if (log.type?.includes('incident.note') && log.agent?.type === 'api_token_reference') {
      const incidentId = log.incident?.id
      const incident = incidents.find((i: any) => i.id === incidentId)
      const serviceId = incident?.service?.id || 'unknown'
      const serviceName = serviceMap.get(serviceId) || 'Unknown'

      signals.push({
        type: 'enrichment_middleware',
        confidence: 'high',
        evidence: 'Incident enrichment via API detected',
        description: `Enrichment pipeline on ${serviceName}`,
        serviceId,
        serviceName,
      })
    }
  })

  // Detect webhook destinations from integrations
  integrations.forEach((intList, serviceId) => {
    const serviceName = serviceMap.get(serviceId) || 'Unknown'
    intList.forEach((integration: any) => {
      // Check for webhook-type integrations
      const vendorName = integration.vendor?.name || integration.name || ''
      if (
        vendorName.toLowerCase().includes('webhook') ||
        vendorName.toLowerCase().includes('custom') ||
        vendorName.toLowerCase().includes('outbound')
      ) {
        webhookDestinationCount++
        signals.push({
          type: 'webhook_destination',
          confidence: 'high',
          evidence: `${vendorName} integration configured`,
          description: `Outbound webhook integration on ${serviceName}`,
          serviceId,
          serviceName,
        })
      }
    })
  })

  // Estimate maintenance burden
  let estimatedMaintenanceBurden: 'low' | 'medium' | 'high' = 'low'
  const totalSignals = signals.length
  if (totalSignals >= 10) {
    estimatedMaintenanceBurden = 'high'
  } else if (totalSignals >= 5) {
    estimatedMaintenanceBurden = 'medium'
  }

  return {
    signals,
    apiConsumerCount,
    webhookDestinationCount,
    automationPatternCount,
    estimatedMaintenanceBurden,
  }
}
