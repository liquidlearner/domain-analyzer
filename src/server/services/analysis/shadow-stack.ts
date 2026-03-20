export interface IncidentIoReplacement {
  feature: string
  action: string
  effort: string
}

export interface WorkflowReference {
  workflowId: string
  workflowName: string
  actions: string[]
  triggerType: string // 'auto-triggered' | 'manual'
}

export interface WebhookReference {
  subscriptionId: string
  name: string
  url: string
  active: boolean
}

export interface AutomationActionReference {
  actionId: string
  actionName: string
  actionType: string // 'process_automation' | 'script'
  totalExecutions: number
  primaryTrigger: string // 'Event Orchestration' | 'Manual' | 'Incident Workflow' | 'Never executed'
  lastRun?: string
  stateCounts: Record<string, number>
  monthlyCounts: Record<string, number>
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
    | 'automation_action'
  confidence: 'high' | 'medium' | 'low'
  evidence: string
  description: string
  serviceId?: string
  serviceName?: string
  count?: number // deduplicated occurrence count
  workflowReferences?: WorkflowReference[] // grouped workflow detail for workflow_integration signals
  webhookReferences?: WebhookReference[] // grouped webhook detail for webhook_destination signals
  automationActionReferences?: AutomationActionReference[] // grouped automation action detail
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
  automation_action: {
    feature: 'incident.io Workflows + Runbooks',
    action: 'Migrate PagerDuty Automation Actions to incident.io Workflows for orchestration-triggered actions, or Runbooks for manual diagnostics. Process automation jobs can be triggered via workflow HTTP steps.',
    effort: 'Medium-High — depends on runner/job complexity',
  },
}

export interface AccountLevelResource {
  pdId: string
  pdType: string
  name: string
  configJson?: any
}

export interface EoDetail {
  eoName: string
  eoPdId: string
  ruleCount: number
  dynamicRouteCount: number
  staticRouteCount: number
  routedServiceIds: string[]
  eoIntegrationNames: string[]
}

// ── Main analysis function ───────────────────────────────────────────
export function analyzeShadowStack(
  incidents: any[],
  logEntries: any[],
  services: any[],
  integrations: Map<string, any[]>,
  serviceToOrchestrations?: Map<string, Array<{ eoName: string; eoPdId: string; ruleCount: number; dynamicRouteCount?: number; eoIntegrationNames?: string[] }>>,
  accountResources?: AccountLevelResource[],
  allEoDetails?: EoDetail[]
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
  // Use allEoDetails (all EOs with their routing info) if available, falling back to serviceToOrchestrations
  const seenEOs = new Set<string>()

  if (allEoDetails && allEoDetails.length > 0) {
    // Full EO detail available — detect all EOs with any routing rules
    for (const eo of allEoDetails) {
      if (seenEOs.has(eo.eoPdId)) continue
      if (eo.ruleCount === 0) continue // No rules at all — skip

      seenEOs.add(eo.eoPdId)
      eoRoutingLayerCount++

      const routeDesc: string[] = []
      if (eo.dynamicRouteCount > 0) routeDesc.push(`${eo.dynamicRouteCount} dynamic route${eo.dynamicRouteCount > 1 ? 's' : ''}`)
      if (eo.staticRouteCount > 0) routeDesc.push(`${eo.staticRouteCount} static route${eo.staticRouteCount > 1 ? 's' : ''}`)
      if (eo.routedServiceIds.length > 0) {
        const svcNames = eo.routedServiceIds.map(id => serviceMap.get(id) || id).slice(0, 3)
        routeDesc.push(`targets: ${svcNames.join(', ')}${eo.routedServiceIds.length > 3 ? ` + ${eo.routedServiceIds.length - 3} more` : ''}`)
      }

      rawSignals.push({
        type: 'eo_routing_layer',
        confidence: 'high',
        evidence: `"${eo.eoName}" — ${eo.ruleCount} routing rule${eo.ruleCount > 1 ? 's' : ''}: ${routeDesc.join(', ')}${eo.eoIntegrationNames.length > 0 ? `. Integrations: ${eo.eoIntegrationNames.join(', ')}` : ''}`,
        description: `Event Orchestration: ${eo.eoName}`,
        serviceId: eo.eoPdId,
        serviceName: eo.eoName,
      })
    }
  } else if (serviceToOrchestrations) {
    // Fallback: use serviceToOrchestrations map (only EOs with explicit service routing)
    serviceToOrchestrations.forEach((eos) => {
      for (const eo of eos) {
        if (!seenEOs.has(eo.eoPdId) && eo.ruleCount >= 1) {
          seenEOs.add(eo.eoPdId)
          eoRoutingLayerCount++
          rawSignals.push({
            type: 'eo_routing_layer',
            confidence: 'high',
            evidence: `"${eo.eoName}" routes via ${eo.ruleCount} rules`,
            description: `Event Orchestration: ${eo.eoName}`,
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
        // Extract vendor/target from URL or name for grouping
        let webhookVendor = 'Other'
        const urlLower = url.toLowerCase()
        const nameLowerWh = nameLower
        if (urlLower.includes('servicenow') || urlLower.includes('service-now') || nameLowerWh.includes('servicenow') || nameLowerWh.includes('snow')) {
          webhookVendor = 'ServiceNow'
        } else if (urlLower.includes('slack') || nameLowerWh.includes('slack')) {
          webhookVendor = 'Slack'
        } else if (urlLower.includes('teams.microsoft') || nameLowerWh.includes('teams')) {
          webhookVendor = 'Microsoft Teams'
        } else if (urlLower.includes('jira') || urlLower.includes('atlassian') || nameLowerWh.includes('jira')) {
          webhookVendor = 'Jira'
        } else if (urlLower.includes('datadog') || nameLowerWh.includes('datadog')) {
          webhookVendor = 'Datadog'
        } else {
          // Try to extract domain from URL
          try {
            const urlObj = new URL(url)
            webhookVendor = urlObj.hostname.replace('www.', '').split('.')[0]
            // Capitalize first letter
            webhookVendor = webhookVendor.charAt(0).toUpperCase() + webhookVendor.slice(1)
          } catch { /* keep 'Other' */ }
        }

        rawSignals.push({
          type: 'webhook_destination',
          confidence: 'high',
          evidence: `Webhook subscription → ${url}${resource.configJson?.active === false ? ' (inactive)' : ''}`,
          description: `${webhookVendor} webhook subscriptions`,
          serviceId: resource.pdId,
          serviceName: resource.name,
          webhookReferences: [{
            subscriptionId: resource.pdId,
            name: resource.name,
            url,
            active: resource.configJson?.active !== false,
          }],
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

        // Actions that live under PD-native vendors but represent external dependencies
        const EXTERNAL_ACTIONS: Record<string, string> = {
          'post-to-external-status-page': 'status-pages', // maps to status-pages vendor for display
        }

        for (const step of steps) {
          const actionId = step.action_configuration?.action_id || ''
          const parts = actionId.split(':')
          if (parts.length >= 3 && parts[0] === 'pagerduty.com') {
            const vendor = parts[1]
            const action = parts[2]

            // Check if this is an external action hiding under a native vendor
            const overrideVendor = EXTERNAL_ACTIONS[action]
            if (overrideVendor) {
              const actions = externalVendors.get(overrideVendor) || []
              actions.push(step.name || action)
              externalVendors.set(overrideVendor, actions)
            } else if (!PD_NATIVE_VENDORS.has(vendor)) {
              const actions = externalVendors.get(vendor) || []
              actions.push(step.name || action || 'unknown action')
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
              workflowReferences: [{
                workflowId: resource.pdId,
                workflowName: resource.name,
                actions: uniqueActions,
                triggerType: triggerLabel,
              }],
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

  // ── Detect automation actions (Runbook Automation / Process Automation) ──
  if (accountResources) {
    const automationActionResources = accountResources.filter(r => r.pdType === 'AUTOMATION_ACTION')

    if (automationActionResources.length > 0) {
      // Group automation actions by primary trigger source for meaningful grouping
      const activeActions: AutomationActionReference[] = []
      const dormantActions: AutomationActionReference[] = []
      let totalAutomationExecutions = 0

      for (const resource of automationActionResources) {
        const config = resource.configJson || {}
        const invocationCount: number = config._invocationCount || 0
        const sourceCounts: Record<string, number> = config._sourceCounts || {}
        const stateCounts: Record<string, number> = config._stateCounts || {}
        const monthlyCounts: Record<string, number> = config._monthlyCounts || {}
        const actionType: string = config.action_type || 'unknown'

        totalAutomationExecutions += invocationCount

        // Determine primary trigger
        let primaryTrigger = 'Never executed'
        if (invocationCount > 0) {
          const eoCount = sourceCounts['event_orchestration_reference'] || 0
          const userCount = sourceCounts['user_reference'] || 0
          const wfCount = sourceCounts['incident_workflow_reference'] || 0
          const maxSource = Math.max(eoCount, userCount, wfCount)
          if (maxSource === eoCount && eoCount > 0) primaryTrigger = 'Event Orchestration'
          else if (maxSource === userCount && userCount > 0) primaryTrigger = 'Manual'
          else if (maxSource === wfCount && wfCount > 0) primaryTrigger = 'Incident Workflow'
          else primaryTrigger = 'Unknown'
        }

        const ref: AutomationActionReference = {
          actionId: resource.pdId,
          actionName: resource.name,
          actionType,
          totalExecutions: invocationCount,
          primaryTrigger,
          lastRun: config.last_run || undefined,
          stateCounts,
          monthlyCounts,
        }

        if (invocationCount > 0) {
          activeActions.push(ref)
        } else {
          dormantActions.push(ref)
        }
      }

      // Sort active actions by execution count descending
      activeActions.sort((a, b) => b.totalExecutions - a.totalExecutions)

      // Count active actions by trigger type for the automationPatternCount
      const orchestrationDrivenCount = activeActions.filter(a => a.primaryTrigger === 'Event Orchestration').length
      const manualCount = activeActions.filter(a => a.primaryTrigger === 'Manual').length
      const workflowDrivenCount = activeActions.filter(a => a.primaryTrigger === 'Incident Workflow').length

      // Update automationPatternCount with active automation actions
      automationPatternCount += activeActions.length

      // Create grouped signal for active automation actions
      if (activeActions.length > 0) {
        const allRefs = [...activeActions]
        // Build a summary description
        const triggerBreakdown: string[] = []
        if (orchestrationDrivenCount > 0) triggerBreakdown.push(`${orchestrationDrivenCount} orchestration-driven`)
        if (manualCount > 0) triggerBreakdown.push(`${manualCount} manual`)
        if (workflowDrivenCount > 0) triggerBreakdown.push(`${workflowDrivenCount} workflow-triggered`)

        rawSignals.push({
          type: 'automation_action',
          confidence: 'high',
          evidence: `${activeActions.length} active automation action${activeActions.length > 1 ? 's' : ''} with ${totalAutomationExecutions.toLocaleString()} total executions (${triggerBreakdown.join(', ')})`,
          description: `PagerDuty Automation Actions (${activeActions.length} active)`,
          automationActionReferences: allRefs,
        })
      }

      // Create a separate signal for dormant/never-executed actions
      if (dormantActions.length > 0) {
        rawSignals.push({
          type: 'automation_action',
          confidence: 'low',
          evidence: `${dormantActions.length} automation action${dormantActions.length > 1 ? 's' : ''} configured but never executed — may be demo/template actions`,
          description: `Dormant Automation Actions (${dormantActions.length} unused)`,
          automationActionReferences: dormantActions,
        })
      }
    }
  }

  // ── Deduplicate: group by (type, serviceId, description) and add counts ──
  // For workflow_integration and webhook_destination, group by description (vendor) to consolidate
  const GROUPED_TYPES = new Set(['workflow_integration', 'webhook_destination', 'automation_action'])
  const dedupKey = (s: typeof rawSignals[0]) =>
    GROUPED_TYPES.has(s.type)
      ? `${s.type}:${s.description}` // dedup by description (vendor/group name)
      : `${s.type}:${s.serviceId || 'global'}`
  const dedupMap = new Map<string, { signal: typeof rawSignals[0]; count: number; workflowRefs: WorkflowReference[]; webhookRefs: WebhookReference[]; automationRefs: AutomationActionReference[] }>()

  for (const signal of rawSignals) {
    const key = dedupKey(signal)
    const existing = dedupMap.get(key)
    if (existing) {
      existing.count++
      if (signal.workflowReferences) existing.workflowRefs.push(...signal.workflowReferences)
      if (signal.webhookReferences) existing.webhookRefs.push(...signal.webhookReferences)
      if (signal.automationActionReferences) existing.automationRefs.push(...signal.automationActionReferences)
    } else {
      dedupMap.set(key, {
        signal,
        count: 1,
        workflowRefs: signal.workflowReferences ? [...signal.workflowReferences] : [],
        webhookRefs: signal.webhookReferences ? [...signal.webhookReferences] : [],
        automationRefs: signal.automationActionReferences ? [...signal.automationActionReferences] : [],
      })
    }
  }

  const signals: ShadowSignal[] = Array.from(dedupMap.values()).map(({ signal, count, workflowRefs, webhookRefs, automationRefs }) => {
    const result: ShadowSignal = {
      ...signal,
      count,
      incidentIoReplacement: REPLACEMENT_MAP[signal.type],
    }
    // Attach grouped references
    if (workflowRefs.length > 0) {
      result.workflowReferences = workflowRefs
      result.evidence = `${workflowRefs.length} workflow${workflowRefs.length > 1 ? 's' : ''} integrating with this vendor`
    }
    if (webhookRefs.length > 0) {
      result.webhookReferences = webhookRefs
      result.evidence = `${webhookRefs.length} webhook subscription${webhookRefs.length > 1 ? 's' : ''} configured`
    }
    if (automationRefs.length > 0) {
      result.automationActionReferences = automationRefs
    }
    return result
  })

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
  if (automationPatternCount > 0) parts.push(`${automationPatternCount} automation pattern${automationPatternCount > 1 ? 's' : ''}`)
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
  if ((!allEoDetails || allEoDetails.length === 0) && (!serviceToOrchestrations || serviceToOrchestrations.size === 0)) {
    dataLimitations.push('Event Orchestration routing data not available — re-export domain config to detect dynamic routing layers.')
  }
  if (!accountResources || accountResources.length === 0) {
    dataLimitations.push('Account-level resources (extensions, webhooks, workflows) not found — re-export domain config to detect these integrations.')
  }

  return {
    signals,
    apiConsumerCount: seenApiConsumers.size,
    webhookDestinationCount,
    automationPatternCount,
    eoRoutingLayerCount,
    estimatedMaintenanceBurden,
    maintenanceNarrative,
    dataLimitations,
  }
}
