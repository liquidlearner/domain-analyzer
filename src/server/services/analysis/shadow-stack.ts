export interface IncidentIoReplacement {
  feature: string
  action: string
  effort: string
}

export interface ShadowSignal {
  type:
    | 'api_consumer'
    | 'webhook_destination'
    | 'auto_ack'
    | 'auto_resolve'
    | 'api_created_incident'
    | 'enrichment_middleware'
    | 'custom_extension'
    | 'eo_routing_layer'
    | 'terraform_consumer'
    | 'analytics_pipeline'
    | 'workflow_integration'
  confidence: 'high' | 'medium' | 'low'
  evidence: string
  description: string
  serviceId?: string
  serviceName?: string
  count?: number // deduplicated occurrence count
  incidentIoReplacement: IncidentIoReplacement
}

export interface ShadowStackAnalysis {
  signals: ShadowSignal[]
  apiConsumerCount: number
  webhookDestinationCount: number
  automationPatternCount: number
  eoRoutingLayerCount: number
  estimatedMaintenanceBurden: 'low' | 'medium' | 'high'
  maintenanceNarrative: string
  dataLimitations: string[]
}

// ── incident.io replacement mapping table ────────────────────────────
const REPLACEMENT_MAP: Record<ShadowSignal['type'], IncidentIoReplacement> = {
  api_consumer: {
    feature: 'incident.io API',
    action: 'Update API endpoint and authentication to incident.io. Review scripts for PD-specific fields.',
    effort: 'Medium — per consumer',
  },
  webhook_destination: {
    feature: 'incident.io Workflows',
    action: 'Replace outbound webhook with a Workflow action or incident.io native webhook.',
    effort: 'Low — 1 day per webhook',
  },
  auto_ack: {
    feature: 'Auto-acknowledge alert rules',
    action: 'Configure auto-acknowledge in incident.io alert route. Decommission custom responder script.',
    effort: 'Low',
  },
  auto_resolve: {
    feature: 'Auto-close alert rules',
    action: 'Configure auto-resolve in incident.io alert route conditions.',
    effort: 'Low',
  },
  api_created_incident: {
    feature: 'incident.io API / Alert Sources',
    action: 'Update incident creation scripts to use incident.io API or point at an alert source URL.',
    effort: 'Medium',
  },
  enrichment_middleware: {
    feature: 'Catalog + Workflows',
    action: 'Replace Lambda/middleware enrichment with Catalog attributes and Workflow steps. CMDB sync via ServiceNow or CSV import.',
    effort: 'Medium — 2-3 days',
  },
  custom_extension: {
    feature: 'incident.io Workflows',
    action: 'Evaluate custom extension functionality and rebuild as Workflow actions.',
    effort: 'High — case by case',
  },
  eo_routing_layer: {
    feature: 'Alert Routes',
    action: 'Map Global Event Orchestration routing rules to incident.io alert routes with condition-based routing.',
    effort: 'Medium-High — depends on rule count',
  },
  terraform_consumer: {
    feature: 'incident.io Terraform Provider',
    action: 'Replace PD Terraform provider with incident.io provider. Update resource definitions and state.',
    effort: 'Medium — 1-2 days per module',
  },
  analytics_pipeline: {
    feature: 'incident.io Webhooks + API',
    action: 'Reconfigure data export pipeline to consume incident.io webhook events or API.',
    effort: 'Medium — 2-3 days',
  },
  workflow_integration: {
    feature: 'incident.io Workflows',
    action: 'Recreate PagerDuty Incident Workflow actions as incident.io Workflow steps. Native integrations (Slack, MS Teams, Jira) are built-in.',
    effort: 'Low-Medium — native integrations map directly',
  },
}

export interface AccountLevelResource {
  pdId: string
  pdType: string
  name: string
  configJson?: any
}

// ── Main analysis function ───────────────────────────────────────────
export function analyzeShadowStack(
  incidents: any[],
  logEntries: any[],
  services: any[],
  integrations: Map<string, any[]>,
  serviceToOrchestrations?: Map<string, Array<{ eoName: string; eoPdId: string; ruleCount: number; eoIntegrationNames?: string[] }>>,
  accountResources?: AccountLevelResource[]
): ShadowStackAnalysis {
  // Collect raw signals then deduplicate
  const rawSignals: Array<Omit<ShadowSignal, 'count' | 'incidentIoReplacement'>> = []
  let apiConsumerCount = 0
  let webhookDestinationCount = 0
  let automationPatternCount = 0
  let eoRoutingLayerCount = 0

  const serviceMap = new Map<string, string>()
  services.forEach((svc: any) => {
    serviceMap.set(svc.id, svc.name || 'Unknown')
  })

  // ── Track unique occurrences to avoid duplicate signals per log entry ──
  const seenApiConsumers = new Set<string>() // serviceId
  const seenAutoAck = new Set<string>() // serviceId
  const seenAutoResolve = new Set<string>() // serviceId
  const seenApiCreated = new Set<string>() // serviceId
  const seenEnrichment = new Set<string>() // serviceId

  // ── Detect patterns from log entries ──
  // PD agent types that indicate API/automation-driven activity
  const API_AGENT_TYPES = new Set([
    'api_token_reference',
    'api_reference',
    'integration_reference',
    'service_reference',
  ])
  const HUMAN_AGENT_TYPES = new Set(['user_reference', 'user'])

  // Track per-service stats for aggregate analysis
  const serviceLogCounts = new Map<string, { total: number; automated: number; agentSummaries: Set<string> }>()

  logEntries.forEach((log: any) => {
    const incidentId = log.incident?.id || log.incident_reference?.id
    const incident = incidentId ? incidents.find((i: any) => i.id === incidentId) : null
    const serviceId = incident?.service?.id || 'unknown'
    const serviceName = serviceMap.get(serviceId) || incident?.service?.summary || 'Unknown'
    const agentType = log.agent?.type || ''
    const agentSummary = log.agent?.summary || ''

    // Track per-service automated vs human activity
    const stats = serviceLogCounts.get(serviceId) || { total: 0, automated: 0, agentSummaries: new Set<string>() }
    stats.total++
    if (API_AGENT_TYPES.has(agentType) || (!HUMAN_AGENT_TYPES.has(agentType) && agentType !== '')) {
      stats.automated++
    }
    if (agentSummary) stats.agentSummaries.add(agentSummary)
    serviceLogCounts.set(serviceId, stats)

    // 1. API consumers (API token / API / integration-driven interactions)
    if (API_AGENT_TYPES.has(agentType) && !HUMAN_AGENT_TYPES.has(agentType)) {
      apiConsumerCount++
      if (!seenApiConsumers.has(serviceId)) {
        seenApiConsumers.add(serviceId)
        rawSignals.push({
          type: 'api_consumer',
          confidence: 'high',
          evidence: `API/automation-driven activity detected (agent type: ${agentType}, summary: ${agentSummary || 'N/A'})`,
          description: `Custom API integration on ${serviceName}`,
          serviceId,
          serviceName,
        })
      }
    }

    // 2. Auto-ack patterns (acknowledged within 10 seconds)
    if (log.type?.includes('acknowledge')) {
      if (incident?.created_at && log.created_at) {
        const createdMs = new Date(incident.created_at).getTime()
        const ackMs = new Date(log.created_at).getTime()
        const diffSeconds = (ackMs - createdMs) / 1000

        if (diffSeconds < 10 && diffSeconds >= 0) {
          automationPatternCount++
          if (!seenAutoAck.has(serviceId)) {
            seenAutoAck.add(serviceId)
            rawSignals.push({
              type: 'auto_ack',
              confidence: 'high',
              evidence: `Acknowledged in ${diffSeconds.toFixed(1)}s — indicates automated responder (agent: ${agentType})`,
              description: `Auto-acknowledge pattern on ${serviceName}`,
              serviceId,
              serviceName,
            })
          }
        }
      }
    }

    // 3. Auto-resolve patterns (resolved within 30 seconds)
    if (log.type?.includes('resolve') && API_AGENT_TYPES.has(agentType)) {
      if (incident?.created_at && log.created_at) {
        const createdMs = new Date(incident.created_at).getTime()
        const resolveMs = new Date(log.created_at).getTime()
        const diffSeconds = (resolveMs - createdMs) / 1000

        if (diffSeconds < 30 && diffSeconds >= 0) {
          automationPatternCount++
          if (!seenAutoResolve.has(serviceId)) {
            seenAutoResolve.add(serviceId)
            rawSignals.push({
              type: 'auto_resolve',
              confidence: 'high',
              evidence: `Auto-resolved in ${diffSeconds.toFixed(1)}s by ${agentType}`,
              description: `Auto-resolve pattern on ${serviceName}`,
              serviceId,
              serviceName,
            })
          }
        }
      }
    }

    // 4. API-created incidents (triggered by non-human agents)
    if (log.type?.includes('trigger') && API_AGENT_TYPES.has(agentType)) {
      if (!seenApiCreated.has(serviceId)) {
        seenApiCreated.add(serviceId)
        rawSignals.push({
          type: 'api_created_incident',
          confidence: 'medium',
          evidence: `Incidents created programmatically (agent: ${agentType}, summary: ${agentSummary || 'N/A'})`,
          description: `Programmatic incident creation on ${serviceName}`,
          serviceId,
          serviceName,
        })
      }
    }

    // 5. Enrichment middleware (notes added by non-human agents)
    if (log.type?.includes('note') && API_AGENT_TYPES.has(agentType)) {
      if (!seenEnrichment.has(serviceId)) {
        seenEnrichment.add(serviceId)
        rawSignals.push({
          type: 'enrichment_middleware',
          confidence: 'high',
          evidence: `Incident notes added programmatically (agent: ${agentType})`,
          description: `Enrichment pipeline on ${serviceName} — custom context being injected`,
          serviceId,
          serviceName,
        })
      }
    }
  })

  // ── Detect services where ALL activity is API-driven (high-confidence shadow stack) ──
  serviceLogCounts.forEach((stats, serviceId) => {
    if (stats.total >= 5 && stats.automated / stats.total > 0.9 && !seenApiConsumers.has(serviceId)) {
      const serviceName = serviceMap.get(serviceId) || 'Unknown'
      seenApiConsumers.add(serviceId)
      apiConsumerCount += stats.automated
      rawSignals.push({
        type: 'api_consumer',
        confidence: 'high',
        evidence: `${stats.automated}/${stats.total} log entries (${Math.round(stats.automated / stats.total * 100)}%) are automation-driven. Agents: ${[...stats.agentSummaries].slice(0, 3).join(', ')}`,
        description: `Fully API-driven incident lifecycle on ${serviceName}`,
        serviceId,
        serviceName,
      })
    }
  })

  // ── Detect webhook/outbound integrations ──
  const seenWebhooks = new Set<string>()
  const analyticsVendors = ['datadog', 'splunk', 'sumo logic', 'sumologic', 'elastic', 'elasticsearch',
    'bigpanda', 'moogsoft', 'newrelic', 'new relic', 'prometheus', 'grafana', 'bigquery',
    'snowflake', 'redshift', 'analytics', 'warehouse', 'pipeline']

  integrations.forEach((intList, serviceId) => {
    const serviceName = serviceMap.get(serviceId) || 'Unknown'
    intList.forEach((integration: any) => {
      const vendorName = (integration.vendor?.name || integration.name || '').toLowerCase()
      const intType = (integration.type || '').toLowerCase()

      // Webhook/outbound integrations
      if (
        vendorName.includes('webhook') ||
        vendorName.includes('custom event') ||
        intType.includes('generic_events_api_inbound') === false && intType.includes('outbound')
      ) {
        const key = `${serviceId}:${vendorName}`
        if (!seenWebhooks.has(key)) {
          seenWebhooks.add(key)
          webhookDestinationCount++

          // Check if it's an analytics pipeline destination
          const isAnalytics = analyticsVendors.some(v => vendorName.includes(v))
          if (isAnalytics) {
            rawSignals.push({
              type: 'analytics_pipeline',
              confidence: 'medium',
              evidence: `${integration.vendor?.name || integration.name} integration configured`,
              description: `Analytics/data pipeline from ${serviceName} to ${integration.vendor?.name || integration.name}`,
              serviceId,
              serviceName,
            })
          } else {
            rawSignals.push({
              type: 'webhook_destination',
              confidence: 'high',
              evidence: `${integration.vendor?.name || integration.name} integration configured`,
              description: `Outbound integration on ${serviceName}`,
              serviceId,
              serviceName,
            })
          }
        }
      }

      // Terraform/IaC detection (look for integrations named after IaC tools)
      if (vendorName.includes('terraform') || vendorName.includes('pulumi') || vendorName.includes('ansible')) {
        rawSignals.push({
          type: 'terraform_consumer',
          confidence: 'medium',
          evidence: `${integration.vendor?.name || integration.name} integration detected`,
          description: `Infrastructure-as-Code integration on ${serviceName}`,
          serviceId,
          serviceName,
        })
      }
    })
  })

  // ── Detect EO routing layer dependencies ──
  if (serviceToOrchestrations) {
    const seenEOs = new Set<string>()
    serviceToOrchestrations.forEach((eos, serviceId) => {
      const serviceName = serviceMap.get(serviceId) || 'Unknown'
      for (const eo of eos) {
        if (!seenEOs.has(eo.eoPdId) && eo.ruleCount >= 1) {
          seenEOs.add(eo.eoPdId)
          eoRoutingLayerCount++
          rawSignals.push({
            type: 'eo_routing_layer',
            confidence: 'high',
            evidence: `"${eo.eoName}" routes to ${serviceToOrchestrations.size} services via ${eo.ruleCount} dynamic rules`,
            description: `Global Event Orchestration "${eo.eoName}" is a routing dependency`,
            serviceId: eo.eoPdId,
            serviceName: eo.eoName,
          })
        }
      }
    })
  }

  // ── Detect account-level extensions, webhooks, and workflows ──
  if (accountResources) {
    const ITSM_VENDORS = ['servicenow', 'snow', 'jira', 'atlassian', 'zendesk', 'freshservice', 'bmc', 'cherwell']
    const COLLAB_VENDORS = ['slack', 'microsoft teams', 'ms teams', 'msteams', 'zoom', 'webex']

    for (const resource of accountResources) {
      const nameLower = (resource.name || '').toLowerCase()

      if (resource.pdType === 'EXTENSION') {
        const schemaName = (resource.configJson?.extension_schema?.summary || '').toLowerCase()
        const isITSM = ITSM_VENDORS.some(v => nameLower.includes(v) || schemaName.includes(v))
        const isCollab = COLLAB_VENDORS.some(v => nameLower.includes(v) || schemaName.includes(v))

        if (isITSM || isCollab) {
          rawSignals.push({
            type: 'custom_extension',
            confidence: 'high',
            evidence: `${resource.name} extension configured${resource.configJson?.temporarily_disabled ? ' (currently disabled)' : ''}`,
            description: `${isITSM ? 'ITSM' : 'Collaboration'} integration: ${resource.name}`,
            serviceId: resource.pdId,
            serviceName: resource.name,
          })
        } else {
          rawSignals.push({
            type: 'custom_extension',
            confidence: 'medium',
            evidence: `${resource.name} extension configured`,
            description: `Extension: ${resource.name}`,
            serviceId: resource.pdId,
            serviceName: resource.name,
          })
        }
      }

      if (resource.pdType === 'WEBHOOK_SUBSCRIPTION') {
        webhookDestinationCount++
        const url = resource.configJson?.delivery_method?.url || 'unknown'
        rawSignals.push({
          type: 'webhook_destination',
          confidence: 'high',
          evidence: `Webhook subscription → ${url}${resource.configJson?.active === false ? ' (inactive)' : ''}`,
          description: `Outbound webhook: ${resource.name}`,
          serviceId: resource.pdId,
          serviceName: resource.name,
        })
      }

      if (resource.pdType === 'INCIDENT_WORKFLOW') {
        const steps = resource.configJson?.steps || []
        const triggers = resource.configJson?.triggers || []

        // Parse action_id to detect external vendor integrations
        // Format: pagerduty.com:{vendor}:{action}:{version}
        // PD native vendors that are internal workflow mechanics, not external integrations
        // Note: status-pages IS flagged as it represents an external dependency (customer-facing status page)
        const PD_NATIVE_VENDORS = new Set(['incident-workflows', 'logic', 'roles', 'tasks'])
        const externalVendors = new Map<string, string[]>() // vendor → list of action descriptions

        for (const step of steps) {
          const actionId = step.action_configuration?.action_id || ''
          const parts = actionId.split(':')
          if (parts.length >= 3 && parts[0] === 'pagerduty.com') {
            const vendor = parts[1]
            if (!PD_NATIVE_VENDORS.has(vendor)) {
              const actions = externalVendors.get(vendor) || []
              actions.push(step.name || parts[2] || 'unknown action')
              externalVendors.set(vendor, actions)
            }
          }
        }

        // Determine trigger type for context
        const triggerTypes = triggers.map((t: any) => t.trigger_type || t.type || 'unknown')
        const isAutomatic = triggerTypes.some((t: string) => t === 'conditional')
        const triggerLabel = isAutomatic ? 'auto-triggered' : 'manual'

        // Vendor display name mapping (vendor segment from action_id pagerduty.com:{vendor}:...)
        const VENDOR_DISPLAY: Record<string, string> = {
          'servicenow': 'ServiceNow',
          'slack': 'Slack',
          'microsoft-teams': 'Microsoft Teams',
          'zoom': 'Zoom',
          'jira': 'Jira',
          'salesforce': 'Salesforce',
          'zendesk': 'Zendesk',
          'aws': 'AWS Lambda',
          'aws-lambda': 'AWS Lambda',
          'grafana': 'Grafana',
          'github': 'GitHub',
          'datadog': 'Datadog',
          'statuspage': 'Statuspage',
          'status-pages': 'PagerDuty Status Page',
        }

        if (externalVendors.size > 0) {
          // Create a signal per external vendor found in this workflow
          for (const [vendor, actions] of externalVendors) {
            const displayName = VENDOR_DISPLAY[vendor] || vendor
            const uniqueActions = [...new Set(actions)]
            rawSignals.push({
              type: 'workflow_integration',
              confidence: 'high',
              evidence: `Workflow "${resource.name}" (${triggerLabel}) → ${displayName}: ${uniqueActions.join(', ')}`,
              description: `${displayName} integration via Incident Workflow`,
              serviceId: resource.pdId,
              serviceName: resource.name,
            })
          }
        } else {
          // Workflow with no external vendors — still noteworthy
          const stepCount = steps.length
          rawSignals.push({
            type: 'custom_extension',
            confidence: 'medium',
            evidence: `Incident workflow "${resource.name}" (${triggerLabel}) with ${stepCount} step${stepCount !== 1 ? 's' : ''} (PD-native actions only)`,
            description: `Incident Workflow: ${resource.name}`,
            serviceId: resource.pdId,
            serviceName: resource.name,
          })
        }
      }
    }
  }

  // ── Deduplicate: group by (type, serviceId) and add counts ──
  const dedupKey = (s: typeof rawSignals[0]) => `${s.type}:${s.serviceId || 'global'}`
  const dedupMap = new Map<string, { signal: typeof rawSignals[0]; count: number }>()

  for (const signal of rawSignals) {
    const key = dedupKey(signal)
    const existing = dedupMap.get(key)
    if (existing) {
      existing.count++
    } else {
      dedupMap.set(key, { signal, count: 1 })
    }
  }

  const signals: ShadowSignal[] = Array.from(dedupMap.values()).map(({ signal, count }) => ({
    ...signal,
    count,
    incidentIoReplacement: REPLACEMENT_MAP[signal.type],
  }))

  // Sort: high confidence first, then by count descending
  signals.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 }
    const confDiff = confOrder[a.confidence] - confOrder[b.confidence]
    if (confDiff !== 0) return confDiff
    return (b.count || 0) - (a.count || 0)
  })

  // ── Estimate maintenance burden ──
  const uniqueSignalTypes = new Set(signals.map(s => s.type))
  let estimatedMaintenanceBurden: 'low' | 'medium' | 'high' = 'low'
  if (uniqueSignalTypes.size >= 5 || signals.length >= 10) {
    estimatedMaintenanceBurden = 'high'
  } else if (uniqueSignalTypes.size >= 3 || signals.length >= 5) {
    estimatedMaintenanceBurden = 'medium'
  }

  // Build narrative
  const parts: string[] = []
  if (apiConsumerCount > 0) parts.push(`${seenApiConsumers.size} custom API integration${seenApiConsumers.size > 1 ? 's' : ''}`)
  if (webhookDestinationCount > 0) parts.push(`${webhookDestinationCount} outbound webhook${webhookDestinationCount > 1 ? 's' : ''}`)
  if (automationPatternCount > 0) parts.push(`${seenAutoAck.size + seenAutoResolve.size} automation pattern${seenAutoAck.size + seenAutoResolve.size > 1 ? 's' : ''}`)
  if (eoRoutingLayerCount > 0) parts.push(`${eoRoutingLayerCount} Event Orchestration routing dependenc${eoRoutingLayerCount > 1 ? 'ies' : 'y'}`)
  if (seenEnrichment.size > 0) parts.push(`${seenEnrichment.size} enrichment pipeline${seenEnrichment.size > 1 ? 's' : ''}`)

  const maintenanceNarrative = parts.length > 0
    ? `Detected ${parts.join(', ')}. These represent ${estimatedMaintenanceBurden} ongoing maintenance that incident.io native features can replace.`
    : 'No significant tool stack dependencies detected.'

  // Track data limitations
  const dataLimitations: string[] = []
  if (logEntries.length === 0) {
    dataLimitations.push('Log entry data was unavailable — API automation patterns, auto-ack/resolve detection, and enrichment middleware could not be assessed.')
  }
  if (!serviceToOrchestrations || serviceToOrchestrations.size === 0) {
    dataLimitations.push('Event Orchestration routing data not available — re-export domain config to detect dynamic routing layers.')
  }
  if (!accountResources || accountResources.length === 0) {
    dataLimitations.push('Account-level resources (extensions, webhooks, workflows) not found — re-export domain config to detect these integrations.')
  }

  return {
    signals,
    apiConsumerCount: seenApiConsumers.size,
    webhookDestinationCount,
    automationPatternCount: seenAutoAck.size + seenAutoResolve.size,
    eoRoutingLayerCount,
    estimatedMaintenanceBurden,
    maintenanceNarrative,
    dataLimitations,
  }
}
