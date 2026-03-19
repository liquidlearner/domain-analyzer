import { prisma } from '@/server/db/client'
import { decryptToken } from '@/server/db/encryption'
import { PagerDutyClient } from '@/server/services/pd/client'
import { jobProgress } from '@/server/services/job-progress'
import { analyzeVolume } from '@/server/services/analysis/volume'
import { analyzeNoise } from '@/server/services/analysis/noise'
import { analyzeSources } from '@/server/services/analysis/sources'
import { analyzeShadowStack } from '@/server/services/analysis/shadow-stack'
import { analyzeRisk } from '@/server/services/analysis/risk'
import { generateProjectPlan } from '@/server/services/analysis/project-plan'
import { compressJson, decompressJson } from '@/lib/compression'

/**
 * Run an evaluation directly (no Inngest required).
 *
 * SCOPE-AWARE: Only analyzes resources related to the selected teams/services.
 * When scopeType=TEAM: pulls incidents for those teams, maps services owned by those teams
 * When scopeType=SERVICE: pulls incidents for those services, maps those services + their deps
 *
 * ORCHESTRATION-AWARE: Inspects stored Event Orchestration router rules to determine
 * how services receive alerts (dynamic routing via Global EO vs direct integration).
 */
export async function runEvaluationAnalysis(evaluationId: string): Promise<void> {
  const jobId = evaluationId

  console.log(`[EvaluationRunner] Starting evaluation ${evaluationId}`)

  try {
    jobProgress.updateProgress(jobId, {
      status: 'running',
      progress: 0,
      message: 'Loading evaluation...',
    })

    // Step 1: Load evaluation, domain, and latest config snapshot
    // Load resources WITHOUT configJson first (lightweight), then selectively load configJson
    const evaluation = await prisma.evaluation.findUnique({
      where: { id: evaluationId },
      include: {
        domain: {
          include: {
            configSnapshots: {
              where: { status: 'COMPLETED' },
              orderBy: { capturedAt: 'desc' },
              take: 1,
              include: {
                resources: {
                  select: {
                    id: true,
                    pdType: true,
                    pdId: true,
                    name: true,
                    teamIds: true,
                    isStale: true,
                    dependencies: true,
                    // Omit configJson here — loaded selectively below
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!evaluation) {
      throw new Error(`Evaluation ${evaluationId} not found`)
    }

    const latestSnapshot = evaluation.domain.configSnapshots?.[0]
    if (!latestSnapshot) {
      throw new Error('No config snapshot found. Run a config sync first.')
    }

    // Selectively load configJson only for resource types that need it during analysis
    // Use raw SQL to avoid Turbopack enum resolution issues with Prisma's `in` filter
    const CONFIG_TYPES = new Set(['EVENT_ORCHESTRATION', 'EXTENSION', 'WEBHOOK_SUBSCRIPTION', 'INCIDENT_WORKFLOW'])
    const resourcesWithConfig = await prisma.pdResource.findMany({
      where: { snapshotId: latestSnapshot.id },
      select: { id: true, pdId: true, pdType: true, name: true, configJson: true },
    })
    const configJsonByPdId = new Map(
      resourcesWithConfig
        .filter((r) => CONFIG_TYPES.has(r.pdType))
        .map((r) => [r.pdId, r.configJson])
    )

    // Update status to INCIDENT_PULL
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { status: 'INCIDENT_PULL', startedAt: new Date() },
    })

    jobProgress.updateProgress(jobId, {
      status: 'running',
      progress: 5,
      message: 'Connecting to PagerDuty...',
    })

    // Decrypt PD token and create client
    const decryptedToken = decryptToken(evaluation.domain.apiTokenEnc)
    const pdClient = new PagerDutyClient({
      token: decryptedToken,
      subdomain: evaluation.domain.subdomain,
    })

    // Calculate time range
    const timeRangeDays = evaluation.timeRangeDays || 30
    const endDate = new Date()
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - timeRangeDays)
    const since = startDate.toISOString()
    const until = endDate.toISOString()

    const scopeType = evaluation.scopeType
    const scopeIds = evaluation.scopeIds || []

    // ── Step 2: Determine scoped resources from config snapshot ──
    // Parse configJson for all resources to build the orchestration routing map
    const allResources = latestSnapshot.resources
    const resourcesByType = new Map<string, typeof allResources>()
    for (const r of allResources) {
      const list = resourcesByType.get(r.pdType) || []
      list.push(r)
      resourcesByType.set(r.pdType, list)
    }

    // Build orchestration → service routing map from stored config
    const eoResources = resourcesByType.get('EVENT_ORCHESTRATION') || []
    // Map: serviceId → list of orchestrations that route to it
    const serviceToOrchestrations = new Map<string, Array<{ eoName: string; eoPdId: string; ruleCount: number; eoIntegrationNames: string[] }>>()
    for (const eo of eoResources) {
      try {
        const rawConfig = configJsonByPdId.get(eo.pdId)
        if (!rawConfig) continue
        const config = decompressJson(rawConfig)
        const routedServiceIds: string[] = config._routedServiceIds || []
        const routerRules = config._routerRules
        const ruleCount = routerRules?.sets?.reduce((n: number, s: any) => n + (s.rules?.length || 0), 0) || 0

        // Extract EO integration names for upstream source identification
        const eoIntegrations: any[] = config.integrations || []
        const eoIntegrationNames: string[] = eoIntegrations
          .map((i: any) => i.label || i.summary || i.type || '')
          .filter((n: string) => n && n !== 'Unknown')

        for (const svcId of routedServiceIds) {
          const existing = serviceToOrchestrations.get(svcId) || []
          existing.push({ eoName: eo.name, eoPdId: eo.pdId, ruleCount, eoIntegrationNames })
          serviceToOrchestrations.set(svcId, existing)
        }
      } catch {
        // configJson parse failed, skip
      }
    }

    // Determine which service PD IDs are in scope
    let scopedServicePdIds: Set<string>
    let scopedTeamPdIds: Set<string>

    if (scopeType === 'TEAM') {
      scopedTeamPdIds = new Set(scopeIds)
      // Services in scope = services owned by the selected teams
      scopedServicePdIds = new Set(
        allResources
          .filter((r) => r.pdType === 'SERVICE' && r.teamIds.some((t) => scopedTeamPdIds.has(t)))
          .map((r) => r.pdId)
      )
    } else {
      // SERVICE scope
      scopedServicePdIds = new Set(scopeIds)
      // Derive teams from the selected services
      scopedTeamPdIds = new Set(
        allResources
          .filter((r) => r.pdType === 'SERVICE' && scopedServicePdIds.has(r.pdId))
          .flatMap((r) => r.teamIds)
      )
    }

    console.log(`[EvaluationRunner] Scope: ${scopedServicePdIds.size} services, ${scopedTeamPdIds.size} teams`)

    // ── Step 3: Pull incidents scoped to selection (progress 10-35%) ──
    jobProgress.updateProgress(jobId, {
      status: 'running',
      progress: 10,
      message: `Pulling incidents for ${scopeIds.length} ${scopeType === 'TEAM' ? 'teams' : 'services'} over ${timeRangeDays} days...`,
    })

    const incidentParams =
      scopeType === 'TEAM'
        ? { teamIds: scopeIds, since, until }
        : { serviceIds: scopeIds, since, until }

    const incidents = await pdClient.listIncidents({
      ...incidentParams,
      onPage: (fetched, hasMore) => {
        const progress = hasMore ? Math.min(10 + Math.floor(fetched / 50), 34) : 35
        jobProgress.updateProgress(jobId, {
          status: 'running',
          progress,
          message: `Pulled ${fetched.toLocaleString()} incidents so far${hasMore ? '...' : '. Done!'}`,
        })
      },
    })

    console.log(`[EvaluationRunner] Pulled ${incidents.length} incidents`)

    jobProgress.updateProgress(jobId, {
      status: 'running',
      progress: 35,
      message: `Pulled ${incidents.length.toLocaleString()} incidents. Fetching scoped service details...`,
    })

    // ── Step 4: Pull service details only for scoped services ──
    const serviceParams =
      scopeType === 'TEAM' ? { teamIds: scopeIds } : {}
    let services = await pdClient.listServices(serviceParams)

    // If SERVICE scope, filter to only selected services
    if (scopeType === 'SERVICE') {
      services = services.filter((s: any) => scopedServicePdIds.has(s.id))
    }

    console.log(`[EvaluationRunner] ${services.length} scoped services`)

    jobProgress.updateProgress(jobId, {
      status: 'running',
      progress: 50,
      message: `Found ${services.length} scoped services. Sampling log entries...`,
    })

    // ── Step 5: Pull log entries (sample for noise analysis) ──
    let logEntries: any[] = []
    try {
      const logSince = timeRangeDays > 30
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        : since

      logEntries = await pdClient.getLogEntries({
        since: logSince,
        until,
        isOverview: false,
        maxEntries: 50000, // Cap to prevent OOM on large accounts
        onPage: (fetched, hasMore) => {
          const progress = hasMore ? Math.min(50 + Math.floor(fetched / 100), 59) : 60
          jobProgress.updateProgress(jobId, {
            status: 'running',
            progress,
            message: `Collected ${fetched.toLocaleString()} log entries${hasMore ? '...' : '. Done!'}`,
          })
        },
      })
    } catch (err) {
      console.warn('[EvaluationRunner] Log entries API failed, continuing without:', err)
    }

    jobProgress.updateProgress(jobId, {
      status: 'running',
      progress: 60,
      message: `Collected ${logEntries.length.toLocaleString()} log entries. Running analysis...`,
    })

    // Update status to ANALYZING
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { status: 'ANALYZING' },
    })

    // ── Step 6: Build integrations map ──
    const integrationsMap = new Map<string, any[]>()
    services.forEach((svc: any) => {
      integrationsMap.set(svc.id, svc.integrations || [])
    })

    // ── Step 6b: Alert payload sampling for source identification (Layer 4) ──
    // Six-layer source detection: when service integrations have null/generic vendor
    // metadata, sample alert payloads and parse titles to identify actual monitoring sources.
    jobProgress.updateProgress(jobId, { status: 'running', progress: 62, message: 'Sampling alert payloads for source identification...' })

    const alertSourceMap = new Map<string, string>() // integrationId → source_origin
    const serviceSourceMap = new Map<string, string>() // serviceId → best source name
    // Track ALL sources found per service (a service can receive from multiple sources)
    const serviceSourcesMulti = new Map<string, Set<string>>() // serviceId → set of source names

    // source_origin domain → friendly display name mapping
    const SOURCE_ORIGIN_DISPLAY: Record<string, string> = {
      'datadoghq.com': 'Datadog',
      'splunkcloud.com': 'Splunk Cloud',
      'splunk.com': 'Splunk',
      'newrelic.com': 'New Relic',
      'amazonaws.com': 'AWS CloudWatch',
      'grafana.com': 'Grafana',
      'grafana.net': 'Grafana',
      'dynatrace.com': 'Dynatrace',
      'sumologic.com': 'Sumo Logic',
      'pingdom.com': 'Pingdom',
      'elastic.co': 'Elastic',
      'opsgenie.com': 'OpsGenie',
      'sentry.io': 'Sentry',
      'statuspage.io': 'Statuspage',
      'pagerduty.com': 'PagerDuty',
    }

    function resolveSourceDisplayName(sourceOrigin: string): string {
      if (!sourceOrigin) return sourceOrigin
      const lower = sourceOrigin.toLowerCase()
      // Direct match
      if (SOURCE_ORIGIN_DISPLAY[lower]) return SOURCE_ORIGIN_DISPLAY[lower]
      // Partial domain match (e.g., cw.us-east-1.amazonaws.com → AWS CloudWatch)
      for (const [domain, name] of Object.entries(SOURCE_ORIGIN_DISPLAY)) {
        if (lower.includes(domain)) {
          // For CloudWatch, include the region if present
          if (domain === 'amazonaws.com') {
            const regionMatch = lower.match(/(?:cw\.|cloudwatch\.)?([\w-]+)\.amazonaws/)
            if (regionMatch) return `${name} (${regionMatch[1]})`
          }
          return name
        }
      }
      return sourceOrigin
    }

    // Identify services with null-vendor integrations that need alert sampling
    const GENERIC_VENDORS = new Set(['change events', 'events api v2', 'events api v1', 'events api', 'email', 'pagerduty', 'unknown'])
    const nullVendorServiceIds: string[] = []
    for (const [serviceId, ints] of integrationsMap) {
      const hasRealVendor = ints.some((i: any) => {
        const vendorName = (i.vendor?.name || '').toLowerCase()
        return vendorName && !GENERIC_VENDORS.has(vendorName)
      })
      if (!hasRealVendor) {
        nullVendorServiceIds.push(serviceId)
      }
    }

    // Phase 1: Bulk title scan — parse source from incident titles
    // Multiple patterns: [Source] prefix, Source: prefix, Source - prefix
    const TITLE_PATTERNS = [
      /^\[([^\]]+)\]/,           // [Datadog] High CPU...
      /^([\w\s]+?):\s/,          // Datadog: High CPU...
      /^([\w\s]+?)\s[-–]\s/,     // Datadog - High CPU...
    ]
    // Known monitoring tool names to validate title-extracted sources
    const KNOWN_SOURCES = new Set([
      'datadog', 'splunk', 'newrelic', 'new relic', 'cloudwatch', 'aws cloudwatch',
      'grafana', 'prometheus', 'nagios', 'zabbix', 'dynatrace', 'sumo logic',
      'elastic', 'kibana', 'pingdom', 'sentry', 'opsgenie', 'appdynamics',
      'thousandeyes', 'catchpoint', 'site24x7', 'logic monitor', 'logicmonitor',
    ])

    const titleSources = new Map<string, Set<string>>() // serviceId → set of sources from titles
    for (const incident of incidents) {
      const serviceId = incident.service?.id
      if (!serviceId) continue
      const title = incident.title || ''
      for (const pattern of TITLE_PATTERNS) {
        const match = title.match(pattern)
        if (match) {
          const extracted = match[1].trim()
          // Validate: only accept if it looks like a known source or is short enough to be a source name
          if (extracted.length <= 30 && (KNOWN_SOURCES.has(extracted.toLowerCase()) || extracted.length <= 15)) {
            const sources = titleSources.get(serviceId) || new Set()
            sources.add(extracted)
            titleSources.set(serviceId, sources)
          }
          break // First matching pattern wins
        }
      }
    }

    console.log(`[EvaluationRunner] Title scan: found sources for ${titleSources.size} services from incident titles`)

    // Phase 2: Per-service targeted sampling — fetch actual alert payloads
    // Sample ALL null-vendor services, not just those without title matches
    // (title matches are hints, alert source_origin is ground truth)
    const servicesToSample = nullVendorServiceIds
    const seenIntegrationIds = new Set<string>()
    let noNewSourceCount = 0
    const MAX_NO_NEW_SOURCE = 20 // Early termination threshold
    let alertsSampled = 0

    if (servicesToSample.length > 0 && servicesToSample.length <= 500) {
      jobProgress.updateProgress(jobId, {
        status: 'running',
        progress: 62,
        message: `Sampling alerts for ${servicesToSample.length} services to identify monitoring sources...`,
      })

      for (const serviceId of servicesToSample) {
        if (noNewSourceCount >= MAX_NO_NEW_SOURCE) break

        // Get a few recent incidents for this service from our already-pulled data
        const serviceIncidents = incidents
          .filter((i: any) => i.service?.id === serviceId)
          .slice(0, 3)

        let foundNew = false
        for (const incident of serviceIncidents) {
          try {
            const alerts = await pdClient.listIncidentAlerts(incident.id, { limit: 1 })
            for (const alert of alerts) {
              alertsSampled++
              const integrationId = alert.integration?.id

              // Only skip if we have a real (non-empty) integration ID we've already seen
              if (integrationId && integrationId.length > 0 && seenIntegrationIds.has(integrationId)) continue
              if (integrationId && integrationId.length > 0) seenIntegrationIds.add(integrationId)

              const sourceOrigin = alert.body?.cef_details?.source_origin
              const sourceComponent = alert.body?.cef_details?.source_component
              const rawSource = sourceOrigin || sourceComponent

              if (rawSource) {
                const displayName = resolveSourceDisplayName(rawSource)
                // Track per-service (primary = first found)
                if (!serviceSourceMap.has(serviceId)) {
                  serviceSourceMap.set(serviceId, displayName)
                }
                // Track all sources per service
                const multi = serviceSourcesMulti.get(serviceId) || new Set()
                multi.add(displayName)
                serviceSourcesMulti.set(serviceId, multi)
                // Cache by integration ID if available
                if (integrationId && integrationId.length > 0) {
                  alertSourceMap.set(integrationId, displayName)
                }
                foundNew = true
                break // Got a source for this service from this incident
              }
            }
          } catch {
            // Alert fetch failed, continue
          }
          if (serviceSourceMap.has(serviceId)) break
        }

        if (foundNew) {
          noNewSourceCount = 0
        } else {
          noNewSourceCount++
        }
      }
    }

    // Merge title sources into serviceSourceMap (title sources are lower priority than alert sampling)
    for (const [serviceId, sources] of titleSources) {
      const firstSource = [...sources][0]
      if (!serviceSourceMap.has(serviceId) && firstSource) {
        serviceSourceMap.set(serviceId, firstSource)
      }
      // Also add to multi-source map
      const multi = serviceSourcesMulti.get(serviceId) || new Set()
      for (const s of sources) multi.add(s)
      serviceSourcesMulti.set(serviceId, multi)
    }

    console.log(`[EvaluationRunner] Alert sampling complete: ${serviceSourceMap.size} service sources identified, ${alertsSampled} alerts sampled, ${alertSourceMap.size} integration IDs cached`)

    // ── Step 7: Run analysis engines ──
    jobProgress.updateProgress(jobId, { status: 'running', progress: 65, message: 'Analyzing incident volume...' })
    const volumeAnalysis = analyzeVolume(incidents, services)

    jobProgress.updateProgress(jobId, { status: 'running', progress: 72, message: 'Analyzing noise patterns...' })
    const noiseAnalysis = analyzeNoise(incidents, logEntries)

    jobProgress.updateProgress(jobId, { status: 'running', progress: 78, message: 'Identifying alert sources...' })
    const sourceAnalysis = analyzeSources(incidents, services, integrationsMap, serviceToOrchestrations, serviceSourceMap, alertSourceMap)

    jobProgress.updateProgress(jobId, { status: 'running', progress: 84, message: 'Detecting shadow stack integrations...' })
    // Gather account-level resources (extensions, webhooks, workflows) for shadow stack detection
    const accountLevelResources = allResources
      .filter((r) => ['EXTENSION', 'WEBHOOK_SUBSCRIPTION', 'INCIDENT_WORKFLOW'].includes(r.pdType))
      .map((r) => {
        let configJson: any = {}
        const rawConfig = configJsonByPdId.get(r.pdId)
        if (rawConfig) {
          try { configJson = decompressJson(rawConfig) } catch { /* empty */ }
        }
        return { pdId: r.pdId, pdType: r.pdType, name: r.name, configJson }
      })
    const shadowStackAnalysis = analyzeShadowStack(incidents, logEntries, services, integrationsMap, serviceToOrchestrations, accountLevelResources)

    jobProgress.updateProgress(jobId, { status: 'running', progress: 88, message: 'Calculating risk assessment...' })
    // Only pass scoped resources into risk analysis — enrich with parsed configJson
    const scopedResources = allResources
      .filter((r) => {
        if (r.pdType === 'SERVICE') return scopedServicePdIds.has(r.pdId)
        if (r.pdType === 'TEAM') return scopedTeamPdIds.has(r.pdId)
        // Include EPs, schedules, etc. that are dependencies of scoped services
        if (r.pdType === 'ESCALATION_POLICY' || r.pdType === 'SCHEDULE') {
          return allResources.some(
            (svc) => svc.pdType === 'SERVICE' && scopedServicePdIds.has(svc.pdId) && svc.dependencies.includes(r.pdId)
          )
        }
        // Include EOs that route to scoped services
        if (r.pdType === 'EVENT_ORCHESTRATION') {
          return r.dependencies?.some((depId) => scopedServicePdIds.has(depId))
        }
        return false
      })
      .map((r) => {
        // Attach parsed configJson from the separate configJson query
        const rawConfig = configJsonByPdId.get(r.pdId)
        let configJson: any = undefined
        if (rawConfig) {
          try { configJson = decompressJson(rawConfig) } catch { /* empty */ }
        }
        return { ...r, configJson }
      })

    const riskAnalysis = analyzeRisk(volumeAnalysis, noiseAnalysis, shadowStackAnalysis, scopedResources, timeRangeDays)

    // ── Step 8: Store results ──
    jobProgress.updateProgress(jobId, { status: 'running', progress: 92, message: 'Storing analysis results...' })

    const noisePatterns = {
      autoResolvedPercent: noiseAnalysis.autoResolvedPercent,
      ackNoActionPercent: noiseAnalysis.ackNoActionPercent,
      escalatedPercent: noiseAnalysis.escalatedPercent,
      transientAlerts: noiseAnalysis.transientAlerts,
      meanTimeToAck: noiseAnalysis.meanTimeToAck,
      meanTimeToResolve: noiseAnalysis.meanTimeToResolve,
      overallNoiseRatio: noiseAnalysis.overallNoiseRatio,
      apiResolvedPercent: noiseAnalysis.apiResolvedPercent,
      apiResolvedCount: noiseAnalysis.apiResolvedCount,
      totalResolved: noiseAnalysis.totalResolved,
    }

    const shadowSignals = shadowStackAnalysis.signals.map((s) => s.type)

    await prisma.incidentAnalysis.create({
      data: {
        evaluationId,
        periodStart: startDate,
        periodEnd: endDate,
        incidentCount: volumeAnalysis.totalIncidents,
        alertCount: volumeAnalysis.totalAlerts,
        noiseRatio: noiseAnalysis.overallNoiseRatio,
        mttrP50: noiseAnalysis.meanTimeToResolve > 0 ? noiseAnalysis.meanTimeToResolve : null,
        mttrP95: null,
        sourcesJson: compressJson({
          sources: sourceAnalysis,
          volume: volumeAnalysis,
          risk: riskAnalysis,
          shadowStack: shadowStackAnalysis,
        }),
        patternsJson: compressJson(noisePatterns),
        shadowSignals,
      },
    })

    // ── Step 9: Create SCOPED migration mappings ──
    jobProgress.updateProgress(jobId, { status: 'running', progress: 96, message: 'Generating migration mappings...' })

    // Link evaluation to the config snapshot
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { configSnapshotId: latestSnapshot.id },
    })

    // Only create mappings for resources in scope (not the entire domain)
    const scopedMappingResources = allResources.filter((r) => {
      if (r.pdType === 'SERVICE') return scopedServicePdIds.has(r.pdId)
      if (r.pdType === 'TEAM') return scopedTeamPdIds.has(r.pdId)
      if (r.pdType === 'ESCALATION_POLICY' || r.pdType === 'SCHEDULE') {
        return allResources.some(
          (svc) => svc.pdType === 'SERVICE' && scopedServicePdIds.has(svc.pdId) && svc.dependencies.includes(r.pdId)
        )
      }
      if (r.pdType === 'EVENT_ORCHESTRATION') {
        return r.dependencies?.some((depId) => scopedServicePdIds.has(depId))
      }
      // Skip users, business services, rulesets unless directly related
      return false
    })

    console.log(`[EvaluationRunner] Creating ${scopedMappingResources.length} scoped migration mappings (vs ${allResources.length} total)`)

    const mappingData = scopedMappingResources.map((resource) => {
      const configJson = configJsonByPdId.get(resource.pdId) || Buffer.from('{}')
      const mapping = getResourceMapping({ ...resource, configJson }, serviceToOrchestrations, integrationsMap)
      return {
        evaluationId,
        pdResourceId: resource.id,
        ioResourceType: mapping.ioResourceType,
        conversionStatus: mapping.conversionStatus,
        effortEstimate: mapping.effortEstimate,
        notes: mapping.notes,
        ioTfSnippet: mapping.ioTfSnippet,
      }
    })

    const CHUNK_SIZE = 500
    for (let i = 0; i < mappingData.length; i += CHUNK_SIZE) {
      await prisma.migrationMapping.createMany({
        data: mappingData.slice(i, i + CHUNK_SIZE),
      })
    }

    // ── Step 10: Generate team-based project plan ──
    jobProgress.updateProgress(jobId, { status: 'running', progress: 98, message: 'Building migration project plan...' })

    const projectPlan = generateProjectPlan(
      scopedMappingResources.map(r => ({
        id: r.id,
        pdType: r.pdType,
        pdId: r.pdId,
        name: r.name,
        teamIds: r.teamIds,
        dependencies: r.dependencies || [],
      })),
      mappingData.map(m => ({
        pdResourceId: m.pdResourceId,
        conversionStatus: m.conversionStatus,
        effortEstimate: m.effortEstimate,
      })),
      volumeAnalysis,
      shadowStackAnalysis,
      riskAnalysis,
      timeRangeDays
    )

    // Update sourcesJson to include project plan and scoped counts
    await prisma.incidentAnalysis.updateMany({
      where: { evaluationId },
      data: {
        sourcesJson: compressJson({
          sources: sourceAnalysis,
          volume: volumeAnalysis,
          risk: riskAnalysis,
          shadowStack: shadowStackAnalysis,
          projectPlan,
          scopedCounts: {
            services: scopedServicePdIds.size,
            teams: scopedTeamPdIds.size,
          },
        }),
      },
    })

    // ── Step 11: Mark evaluation as COMPLETED ──
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })

    jobProgress.updateProgress(jobId, {
      status: 'completed',
      progress: 100,
      message: `Analysis complete. ${incidents.length} incidents analyzed across ${services.length} services.`,
    })

    console.log(
      `[EvaluationRunner] Completed ${evaluationId}: ` +
        `${incidents.length} incidents, ${services.length} services, ` +
        `${scopedMappingResources.length} mappings, ` +
        `risk=${riskAnalysis.overallComplexity}`
    )
  } catch (error) {
    console.error(`[EvaluationRunner] Failed ${evaluationId}:`, error instanceof Error ? error.stack : error)

    try {
      await prisma.evaluation.update({
        where: { id: evaluationId },
        data: { status: 'FAILED' },
      })
    } catch {
      // Ignore update failure
    }

    jobProgress.updateProgress(jobId, {
      status: 'failed',
      progress: 0,
      message: error instanceof Error ? error.message : 'Unknown error during analysis',
    })
  }
}

// ─── Migration Mapping Logic ────────────────────────────────────────────

interface MappingResult {
  ioResourceType: string | null
  conversionStatus: 'AUTO' | 'MANUAL' | 'SKIP' | 'UNSUPPORTED'
  effortEstimate: string | null
  notes: string | null
  ioTfSnippet: string | null
}

/**
 * Map PD resource types to incident.io equivalents.
 * ORCHESTRATION-AWARE: detects dynamic routing via Global Event Orchestration.
 */
function getResourceMapping(
  resource: {
    pdType: string
    pdId: string
    name: string
    teamIds: string[]
    configJson: Uint8Array
    dependencies: string[]
  },
  serviceToOrchestrations: Map<string, Array<{ eoName: string; eoPdId: string; ruleCount: number }>>,
  integrationsMap: Map<string, any[]>,
): MappingResult {
  switch (resource.pdType) {
    case 'SCHEDULE':
      return {
        ioResourceType: 'incident_schedule',
        conversionStatus: 'AUTO',
        effortEstimate: 'Low',
        notes: 'On-call schedules map directly to incident.io schedules via Terraform.',
        ioTfSnippet: `resource "incident_schedule" "${sanitizeName(resource.name)}" {\n  name = "${resource.name}"\n}`,
      }

    case 'ESCALATION_POLICY':
      return {
        ioResourceType: 'incident_escalation_path',
        conversionStatus: 'AUTO',
        effortEstimate: 'Low',
        notes: 'Escalation policies map to incident.io escalation paths via Terraform.',
        ioTfSnippet: `resource "incident_escalation_path" "${sanitizeName(resource.name)}" {\n  name = "${resource.name}"\n}`,
      }

    case 'TEAM':
      return {
        ioResourceType: 'incident_catalog_entry',
        conversionStatus: 'AUTO',
        effortEstimate: 'Low',
        notes: 'Teams map to incident.io catalog entries (Team type) via Terraform.',
        ioTfSnippet: `resource "incident_catalog_entry" "${sanitizeName(resource.name)}" {\n  catalog_type_id = "team"\n  name = "${resource.name}"\n}`,
      }

    case 'SERVICE':
      return getServiceMapping(resource, serviceToOrchestrations, integrationsMap)

    case 'BUSINESS_SERVICE':
      return {
        ioResourceType: 'incident_catalog_entry',
        conversionStatus: 'MANUAL',
        effortEstimate: 'Medium',
        notes: 'Business services map to incident.io catalog entries with custom attributes.',
        ioTfSnippet: null,
      }

    case 'EVENT_ORCHESTRATION':
      return getOrchestrationMapping(resource)

    case 'RULESET':
      return {
        ioResourceType: null,
        conversionStatus: 'UNSUPPORTED',
        effortEstimate: 'High',
        notes: 'Legacy rulesets are deprecated in PagerDuty. Convert to incident.io alert routes.',
        ioTfSnippet: null,
      }

    case 'USER':
      return {
        ioResourceType: null,
        conversionStatus: 'SKIP',
        effortEstimate: null,
        notes: 'Users are provisioned via SSO/SCIM — no migration needed.',
        ioTfSnippet: null,
      }

    default:
      return {
        ioResourceType: null,
        conversionStatus: 'MANUAL',
        effortEstimate: 'Unknown',
        notes: `Unknown resource type: ${resource.pdType}`,
        ioTfSnippet: null,
      }
  }
}

/**
 * Determine the migration mapping for a SERVICE by inspecting:
 * 1. Whether it receives alerts via Global Event Orchestration dynamic routing
 * 2. What direct integrations it has (email, API, monitoring tools)
 */
function getServiceMapping(
  resource: { pdId: string; name: string; configJson: Uint8Array },
  serviceToOrchestrations: Map<string, Array<{ eoName: string; eoPdId: string; ruleCount: number }>>,
  integrationsMap: Map<string, any[]>,
): MappingResult {
  const eos = serviceToOrchestrations.get(resource.pdId) || []
  const integrations = integrationsMap.get(resource.pdId) || []

  // Classify integrations
  const integrationTypes: string[] = []
  let hasEmailIntegration = false
  let hasApiIntegration = false
  let monitoringTools: string[] = []

  for (const intg of integrations) {
    const type = (intg.type || '').toLowerCase()
    const vendor = (intg.vendor?.name || intg.name || '').toLowerCase()
    const summary = (intg.summary || '').toLowerCase()

    if (type.includes('email') || vendor.includes('email')) {
      hasEmailIntegration = true
      integrationTypes.push('Email')
    } else if (type.includes('events_api') || type.includes('generic_events_api')) {
      hasApiIntegration = true
      integrationTypes.push('Events API')
    }

    // Detect common monitoring tool integrations
    const knownTools = ['datadog', 'cloudwatch', 'new relic', 'newrelic', 'grafana', 'prometheus',
      'splunk', 'nagios', 'zabbix', 'dynatrace', 'sumo logic', 'elastic', 'pingdom',
      'statuspage', 'jira', 'servicenow', 'terraform', 'aws', 'gcp', 'azure']
    for (const tool of knownTools) {
      if (vendor.includes(tool) || summary.includes(tool) || type.includes(tool)) {
        monitoringTools.push(vendor || summary || type)
        break
      }
    }
  }
  // Deduplicate
  monitoringTools = [...new Set(monitoringTools)]

  // Build notes based on what we found
  const notes: string[] = []
  let conversionStatus: 'AUTO' | 'MANUAL' = 'MANUAL'
  let effortEstimate = 'Medium'

  if (eos.length > 0) {
    // Service receives alerts via Global Event Orchestration
    const eoNames = eos.map((e) => e.eoName).join(', ')
    notes.push(`Routed via Global Event Orchestration: ${eoNames}.`)
    notes.push('Dynamic routing in PD maps to incident.io alert routes — straightforward to replicate.')
    conversionStatus = 'AUTO'
    effortEstimate = 'Low'
  }

  if (integrations.length === 0 && eos.length === 0) {
    notes.push('No integrations or orchestration routing detected. May be inactive or manually triggered.')
    effortEstimate = 'Low'
  }

  if (hasEmailIntegration) {
    notes.push('Has email integration — incident.io supports email alert sources natively.')
  }

  if (hasApiIntegration && eos.length === 0) {
    notes.push('Uses Events API directly — update the integration endpoint to incident.io alert source URL.')
  }

  if (monitoringTools.length > 0) {
    notes.push(`Connected monitoring tools: ${monitoringTools.join(', ')}.`)
  }

  if (notes.length === 0) {
    notes.push('Service catalog entry in incident.io. Review alert routing configuration.')
  }

  return {
    ioResourceType: 'incident_catalog_entry',
    conversionStatus,
    effortEstimate,
    notes: notes.join(' '),
    ioTfSnippet: conversionStatus === 'AUTO'
      ? `resource "incident_catalog_entry" "${sanitizeName(resource.name)}" {\n  catalog_type_id = "service"\n  name = "${resource.name}"\n}`
      : null,
  }
}

/**
 * Determine the migration mapping for an EVENT_ORCHESTRATION by inspecting
 * how many rules and services it routes to.
 */
function getOrchestrationMapping(
  resource: { pdId: string; name: string; configJson: Uint8Array; dependencies: string[] },
): MappingResult {
  let ruleCount = 0
  let routedServiceCount = 0

  try {
    const config = JSON.parse(Buffer.from(resource.configJson).toString('utf-8'))
    routedServiceCount = (config._routedServiceIds || []).length
    const routerRules = config._routerRules
    ruleCount = routerRules?.sets?.reduce((n: number, s: any) => n + (s.rules?.length || 0), 0) || 0
  } catch {
    // configJson parse failed
  }

  const notes: string[] = []

  if (routedServiceCount > 0) {
    notes.push(`Routes to ${routedServiceCount} service${routedServiceCount > 1 ? 's' : ''} via ${ruleCount} dynamic routing rule${ruleCount > 1 ? 's' : ''}.`)
    notes.push('Global Event Orchestration dynamic routing maps to incident.io alert routes with condition-based routing.')
    if (ruleCount <= 5) {
      notes.push('Low rule count — straightforward migration.')
    } else if (ruleCount <= 20) {
      notes.push('Moderate rule count — review conditions for complexity.')
    } else {
      notes.push('High rule count — recommend phased migration of routing rules.')
    }
  } else {
    notes.push('No dynamic routing rules detected. May use service-level orchestration or be inactive.')
  }

  return {
    ioResourceType: 'incident_alert_route',
    conversionStatus: routedServiceCount > 0 && ruleCount <= 10 ? 'MANUAL' : 'MANUAL',
    effortEstimate: ruleCount <= 5 ? 'Low' : ruleCount <= 20 ? 'Medium' : 'High',
    notes: notes.join(' '),
    ioTfSnippet: null,
  }
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}
