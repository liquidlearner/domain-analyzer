import type { VolumeAnalysis } from '../analysis/volume'
import type { NoiseAnalysis } from '../analysis/noise'
import type { SourceAnalysis } from '../analysis/sources'
import type { ShadowStackAnalysis } from '../analysis/shadow-stack'
import type { RiskAnalysis } from '../analysis/risk'
import type { TeamMigrationPlan, TeamPhase } from '../analysis/project-plan'

export interface AnalysisData {
  volume: VolumeAnalysis | null
  sources: SourceAnalysis | null
  risk: RiskAnalysis | null
  shadowStack: ShadowStackAnalysis | null
  projectPlan: TeamMigrationPlan | null
  noise: NoiseAnalysis | null
  scopedCounts: { services: number; teams: number } | null
  meta: {
    incidentCount: number
    alertCount: number
    noiseRatio: number
    mttrP50: number | null
    mttrP95: number | null
    periodStart: Date
    periodEnd: Date
    shadowSignals: string[]
  }
}

export interface EvaluationInfo {
  id: string
  domain: { subdomain: string } | null
  configSnapshot: {
    resources: Array<{
      id: string
      pdType: string
      pdId: string
      name: string
      teamIds: string[]
    }>
  } | null
  migrationMappings: Array<{
    pdResourceId: string
    ioResourceType: string | null
    conversionStatus: string
    effortEstimate: string | null
  }>
  scopeType: string
  timeRangeDays: number
  completedAt: Date | null
}

export interface AdvisorContext {
  systemContext: string
}

/**
 * Build a token-efficient text summary of the evaluation analysis data
 * for use as context in AI advisor conversations.
 * Target: ~3,000-4,000 tokens of context.
 */
export function buildAdvisorContext(
  evaluation: EvaluationInfo,
  analysisData: AnalysisData
): AdvisorContext {
  const sections: string[] = []

  // Section 1: Domain Overview
  sections.push(buildDomainOverview(evaluation, analysisData))

  // Section 2: Volume Snapshot
  if (analysisData.volume) {
    sections.push(buildVolumeSnapshot(analysisData.volume, analysisData.meta, evaluation.timeRangeDays))
  }

  // Section 3: Noise Profile
  if (analysisData.noise) {
    sections.push(buildNoiseProfile(analysisData.noise, analysisData.meta))
  }

  // Section 4: Alert Source Map
  if (analysisData.sources) {
    sections.push(buildSourceMap(analysisData.sources))
  }

  // Section 5: Shadow Stack / Tool Stack
  if (analysisData.shadowStack) {
    sections.push(buildShadowStack(analysisData.shadowStack))
  }

  // Section 6: Config Map Summary
  sections.push(buildConfigMapSummary(evaluation))

  // Section 7: Risk Profile
  if (analysisData.risk) {
    sections.push(buildRiskProfile(analysisData.risk))
  }

  // Section 8: Project Plan Summary
  if (analysisData.projectPlan) {
    sections.push(buildProjectPlanSummary(analysisData.projectPlan))
  }

  return {
    systemContext: sections.join('\n\n'),
  }
}

/**
 * Build expanded team detail for on-demand drill-down.
 */
export function expandTeamDetail(
  teamId: string,
  evaluation: EvaluationInfo,
  analysisData: AnalysisData
): string | null {
  const plan = analysisData.projectPlan
  if (!plan) return null

  const team = plan.teams.find(t => t.teamId === teamId)
  if (!team) return null

  const teamResources = evaluation.configSnapshot?.resources.filter(
    r => r.teamIds.includes(teamId)
  ) || []

  const teamMappings = evaluation.migrationMappings.filter(m =>
    teamResources.some(r => r.id === m.pdResourceId)
  )

  const autoCount = teamMappings.filter(m => m.conversionStatus === 'AUTO').length
  const manualCount = teamMappings.filter(m => m.conversionStatus === 'MANUAL').length
  const skipCount = teamMappings.filter(m => m.conversionStatus === 'SKIP').length
  const unsupportedCount = teamMappings.filter(m => m.conversionStatus === 'UNSUPPORTED').length

  const services = teamResources.filter(r => r.pdType === 'SERVICE')
  const schedules = teamResources.filter(r => r.pdType === 'SCHEDULE')
  const eps = teamResources.filter(r => r.pdType === 'ESCALATION_POLICY')

  const lines = [
    `## Team Detail: ${team.teamName}`,
    `Risk Score: ${team.riskScore}/10 | Recommended Wave: ${team.recommendedWave} | Effort: ${team.effortDays} days`,
    `Incidents/Month: ${team.incidentsPerMonth} | Shadow Stack Signals: ${team.shadowStackSignalCount}`,
    '',
    `Resources: ${services.length} services, ${schedules.length} schedules, ${eps.length} EPs`,
    `Services: ${services.map(s => s.name).join(', ') || 'None'}`,
    '',
    `Migration Mapping: ${autoCount} AUTO, ${manualCount} MANUAL, ${skipCount} SKIP, ${unsupportedCount} UNSUPPORTED`,
  ]

  if (team.riskFlags.length > 0) {
    lines.push(`Risk Flags: ${team.riskFlags.join('; ')}`)
  }

  return lines.join('\n')
}

// ── Section builders ──────────────────────────────────────────────

function buildDomainOverview(evaluation: EvaluationInfo, analysisData: AnalysisData): string {
  const subdomain = evaluation.domain?.subdomain || 'unknown'
  const teamCount = analysisData.scopedCounts?.teams ?? 0
  const serviceCount = analysisData.scopedCounts?.services ?? 0
  const periodStart = analysisData.meta.periodStart
    ? new Date(analysisData.meta.periodStart).toISOString().split('T')[0]
    : 'N/A'
  const periodEnd = analysisData.meta.periodEnd
    ? new Date(analysisData.meta.periodEnd).toISOString().split('T')[0]
    : 'N/A'

  return [
    '## Domain Overview',
    `Customer Domain: ${subdomain}.pagerduty.com`,
    `Scope: ${teamCount} teams, ${serviceCount} services`,
    `Time Range: ${evaluation.timeRangeDays} days (${periodStart} to ${periodEnd})`,
    `Analysis Completed: ${evaluation.completedAt ? new Date(evaluation.completedAt).toISOString().split('T')[0] : 'N/A'}`,
  ].join('\n')
}

function buildVolumeSnapshot(volume: VolumeAnalysis, meta: AnalysisData['meta'], periodDays: number): string {
  const dailyAvg = periodDays > 0 ? (volume.totalIncidents / periodDays).toFixed(1) : 'N/A'
  const top5 = volume.topNoisiest.slice(0, 5)
    .map(s => `${s.serviceName}: ${s.count}`)
    .join(', ')

  const severitySplit = volume.severityDistribution
    .map(s => `${s.severity}: ${s.count}`)
    .join(', ')

  // Find peak hours
  const sortedHours = [...volume.incidentsByHour].sort((a, b) => b.count - a.count)
  const peakHours = sortedHours.slice(0, 3).map(h => `${String(h.hour).padStart(2, '0')}:00`).join(', ')

  return [
    '## Volume Snapshot',
    `Total Incidents: ${volume.totalIncidents} (${dailyAvg}/day avg)`,
    `Total Alerts: ${volume.totalAlerts}`,
    `Top 5 Noisiest Services: ${top5 || 'N/A'}`,
    `Severity Split: ${severitySplit || 'N/A'}`,
    `Peak Hours (UTC): ${peakHours || 'N/A'}`,
  ].join('\n')
}

function buildNoiseProfile(noise: NoiseAnalysis, meta: AnalysisData['meta']): string {
  const mttaMin = noise.meanTimeToAck > 0 ? (noise.meanTimeToAck / 60).toFixed(1) : 'N/A'
  const mttrMin = noise.meanTimeToResolve > 0 ? (noise.meanTimeToResolve / 60).toFixed(1) : 'N/A'

  return [
    '## Noise Profile',
    `Overall Noise Ratio: ${(meta.noiseRatio * 100).toFixed(1)}%`,
    `Auto-resolved (no human ack): ${(noise.autoResolvedPercent * 100).toFixed(1)}%`,
    `Ack but no action: ${(noise.ackNoActionPercent * 100).toFixed(1)}%`,
    `Escalated: ${(noise.escalatedPercent * 100).toFixed(1)}%`,
    `MTTA: ${mttaMin} min | MTTR: ${mttrMin} min`,
    `API-resolved: ${(noise.apiResolvedPercent * 100).toFixed(1)}% (${noise.apiResolvedCount} of ${noise.totalResolved} resolved)`,
    noise.logEntriesAvailable
      ? 'Log entry data: Available (accurate noise detection)'
      : 'Log entry data: Unavailable (noise estimates are approximate)',
  ].join('\n')
}

function buildSourceMap(sources: SourceAnalysis): string {
  const topSources = sources.sources
    .slice(0, 8)
    .map(s => `${s.sourceName} (${s.percentOfTotal.toFixed(1)}%)`)
    .join(', ')

  const lines = [
    '## Alert Source Map',
    `Sources: ${topSources || 'N/A'}`,
    `From Monitoring: ${sources.totalFromMonitoring} | API: ${sources.totalFromApi} | Email: ${sources.totalFromEmail} | Orchestration: ${sources.totalFromOrchestration}`,
    `Pre-filter Assessment: ${sources.preFilteredAssessment}`,
  ]

  if (sources.orchestrationRouting && sources.orchestrationRouting.length > 0) {
    const eoSummary = sources.orchestrationRouting
      .map(eo => `${eo.orchestrationName} (${eo.routedServiceCount} services, ${eo.ruleCount} rules)`)
      .join('; ')
    lines.push(`EO Routing: ${eoSummary}`)
  }

  return lines.join('\n')
}

function buildShadowStack(shadow: ShadowStackAnalysis): string {
  const signalSummary = shadow.signals
    .slice(0, 10)
    .map(s => {
      const svc = s.serviceName ? ` (${s.serviceName})` : ''
      return `- [${s.confidence}] ${s.type}: ${s.description}${svc}`
    })
    .join('\n')

  return [
    '## Shadow Stack / Tool Stack',
    `Maintenance Burden: ${shadow.estimatedMaintenanceBurden.toUpperCase()}`,
    `API Consumers: ${shadow.apiConsumerCount} | Webhooks: ${shadow.webhookDestinationCount} | Automation Patterns: ${shadow.automationPatternCount} | EO Routing Layers: ${shadow.eoRoutingLayerCount}`,
    shadow.maintenanceNarrative,
    '',
    'Key Signals:',
    signalSummary || 'None detected',
  ].join('\n')
}

function buildConfigMapSummary(evaluation: EvaluationInfo): string {
  const mappings = evaluation.migrationMappings
  const total = mappings.length
  const auto = mappings.filter(m => m.conversionStatus === 'AUTO').length
  const manual = mappings.filter(m => m.conversionStatus === 'MANUAL').length
  const skip = mappings.filter(m => m.conversionStatus === 'SKIP').length
  const unsupported = mappings.filter(m => m.conversionStatus === 'UNSUPPORTED').length

  const resources = evaluation.configSnapshot?.resources || []
  const typeCounts = new Map<string, number>()
  resources.forEach(r => {
    typeCounts.set(r.pdType, (typeCounts.get(r.pdType) ?? 0) + 1)
  })

  const typeBreakdown = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type.toLowerCase().replace(/_/g, ' ')}s`)
    .join(', ')

  return [
    '## Config Map Summary',
    `Total Resources: ${resources.length}`,
    `Breakdown: ${typeBreakdown || 'N/A'}`,
    '',
    `Migration Mapping (${total} resources):`,
    `- AUTO: ${auto} | MANUAL: ${manual} | SKIP: ${skip} | UNSUPPORTED: ${unsupported}`,
  ].join('\n')
}

function buildRiskProfile(risk: RiskAnalysis): string {
  const signalLines = risk.signals
    .slice(0, 10)
    .map(s => `- [${s.severity.toUpperCase()}] ${s.description}`)
    .join('\n')

  return [
    '## Risk Profile',
    `Overall Complexity: ${risk.overallComplexity}`,
    '',
    'Risk Signals:',
    signalLines || 'None detected',
  ].join('\n')
}

function buildProjectPlanSummary(plan: TeamMigrationPlan): string {
  const timeline = plan.overallTimeline

  const pilotLines = plan.pilotRecommendations
    .slice(0, 3)
    .map((p, i) => `${i + 1}. ${p.teamName} — ${p.reason} (${p.incidentsPerMonth} incidents/month, ${p.serviceCount} services)`)
    .join('\n')

  const waveGroups = new Map<number, TeamPhase[]>()
  plan.teams.forEach(t => {
    const wave = t.recommendedWave
    if (!waveGroups.has(wave)) waveGroups.set(wave, [])
    waveGroups.get(wave)!.push(t)
  })

  const waveLines = Array.from(waveGroups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([wave, teams]) => {
      const totalEffort = teams.reduce((sum, t) => sum + t.effortDays, 0)
      const teamNames = teams.map(t => t.teamName).join(', ')
      return `- Wave ${wave} (${teams.length} teams, ${totalEffort} effort-days): ${teamNames}`
    })
    .join('\n')

  const shadowLines = plan.shadowStackRoadmap
    .slice(0, 6)
    .map(s => `- Phase ${s.phase}: ${s.description} (${s.effort}) → ${s.incidentIoFeature}`)
    .join('\n')

  return [
    '## Project Plan Summary',
    `Estimated Timeline: ${timeline.estimatedMonths} months (${timeline.totalWeeks} weeks)`,
    `Total Effort: ${timeline.totalEffortDays} person-days`,
    `Complexity: ${timeline.complexity}`,
    '',
    'Pilot Recommendations:',
    pilotLines || 'N/A',
    '',
    'Wave Assignments:',
    waveLines || 'N/A',
    '',
    'Shadow Stack Roadmap:',
    shadowLines || 'N/A',
  ].join('\n')
}
