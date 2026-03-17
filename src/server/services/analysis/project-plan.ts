import type { VolumeAnalysis } from './volume'
import type { ShadowStackAnalysis } from './shadow-stack'
import type { RiskAnalysis } from './risk'

// ── Types ────────────────────────────────────────────────────────────

export interface TeamPhase {
  teamId: string
  teamName: string
  serviceCount: number
  scheduleCount: number
  epCount: number
  incidentVolume: number
  incidentsPerMonth: number
  riskScore: number // 1-10
  shadowStackSignalCount: number
  recommendedWave: number // 1, 2, 3
  effortDays: number
  riskFlags: string[]
}

export interface PilotRecommendation {
  teamId: string
  teamName: string
  reason: string
  score: number // higher = better pilot candidate
  serviceCount: number
  incidentsPerMonth: number
}

export interface ProjectPhase {
  phase: number
  name: string
  duration: string
  description: string
  teams: string[] // team names in this phase
  tasks: string[]
  effortDays: number
}

export interface ShadowStackRoadmapItem {
  signalType: string
  description: string
  phase: number
  phaseName: string
  effort: string
  incidentIoFeature: string
}

export interface TeamMigrationPlan {
  teams: TeamPhase[]
  pilotRecommendations: PilotRecommendation[]
  overallTimeline: {
    totalWeeks: number
    totalEffortDays: number
    complexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'VERY_COMPLEX'
    estimatedMonths: number
  }
  phases: ProjectPhase[]
  shadowStackRoadmap: ShadowStackRoadmapItem[]
}

// ── Main function ────────────────────────────────────────────────────

export function generateProjectPlan(
  resources: Array<{
    id: string
    pdType: string
    pdId: string
    name: string
    teamIds: string[]
    dependencies: string[]
  }>,
  migrationMappings: Array<{
    pdResourceId: string
    conversionStatus: string
    effortEstimate: string | null
  }>,
  volumeAnalysis: VolumeAnalysis,
  shadowStackAnalysis: ShadowStackAnalysis,
  riskAnalysis: RiskAnalysis,
  timeRangeDays: number
): TeamMigrationPlan {

  // ── Build team-centric view ──
  const teamResources = resources.filter(r => r.pdType === 'TEAM')
  const serviceResources = resources.filter(r => r.pdType === 'SERVICE')
  const scheduleResources = resources.filter(r => r.pdType === 'SCHEDULE')
  const epResources = resources.filter(r => r.pdType === 'ESCALATION_POLICY')

  // Map effort estimates by resource ID
  const effortByResourceId = new Map<string, string>()
  const statusByResourceId = new Map<string, string>()
  migrationMappings.forEach(m => {
    if (m.effortEstimate) effortByResourceId.set(m.pdResourceId, m.effortEstimate)
    statusByResourceId.set(m.pdResourceId, m.conversionStatus)
  })

  // Build volume by service PD ID
  const volumeByServiceId = new Map<string, number>()
  volumeAnalysis.incidentsByService.forEach(s => {
    volumeByServiceId.set(s.serviceId, s.count)
  })

  // Build shadow stack signals by service
  const shadowByService = new Map<string, number>()
  shadowStackAnalysis.signals.forEach(s => {
    if (s.serviceId) {
      shadowByService.set(s.serviceId, (shadowByService.get(s.serviceId) || 0) + 1)
    }
  })

  // ── Compute per-team metrics ──
  const teams: TeamPhase[] = teamResources.map(team => {
    const teamServices = serviceResources.filter(s => s.teamIds.includes(team.pdId))
    const teamSchedules = scheduleResources.filter(s => s.teamIds.includes(team.pdId))
    const teamEPs = epResources.filter(ep => {
      // EP is related if a team service depends on it
      return teamServices.some(svc => svc.dependencies.includes(ep.pdId))
    })

    const incidentVolume = teamServices.reduce((sum, svc) => {
      return sum + (volumeByServiceId.get(svc.pdId) || 0)
    }, 0)
    const incidentsPerMonth = timeRangeDays > 0 ? (incidentVolume / timeRangeDays) * 30 : 0

    const shadowStackSignalCount = teamServices.reduce((sum, svc) => {
      return sum + (shadowByService.get(svc.pdId) || 0)
    }, 0)

    // Calculate effort from mappings
    const teamResourceIds = new Set([
      team.id,
      ...teamServices.map(s => s.id),
      ...teamSchedules.map(s => s.id),
      ...teamEPs.map(ep => ep.id),
    ])
    let effortDays = 0
    teamResourceIds.forEach(rid => {
      const effort = effortByResourceId.get(rid)
      if (effort) effortDays += parseEffortToDays(effort)
    })
    // Minimum 1 day per team
    effortDays = Math.max(effortDays, 1)

    // Risk scoring (1-10)
    let riskScore = 1
    const riskFlags: string[] = []

    if (incidentsPerMonth > 200) { riskScore += 3; riskFlags.push('High incident volume') }
    else if (incidentsPerMonth > 50) { riskScore += 1; riskFlags.push('Moderate incident volume') }

    if (shadowStackSignalCount > 5) { riskScore += 3; riskFlags.push('Heavy shadow stack dependencies') }
    else if (shadowStackSignalCount > 2) { riskScore += 1; riskFlags.push('Some shadow stack dependencies') }

    if (teamServices.length > 20) { riskScore += 2; riskFlags.push('Large service footprint') }
    else if (teamServices.length > 10) { riskScore += 1; riskFlags.push('Moderate service count') }

    const manualCount = teamServices.filter(s => statusByResourceId.get(s.id) === 'MANUAL').length
    if (manualCount > teamServices.length * 0.5) { riskScore += 1; riskFlags.push('High manual conversion ratio') }

    riskScore = Math.min(riskScore, 10)

    return {
      teamId: team.pdId,
      teamName: team.name,
      serviceCount: teamServices.length,
      scheduleCount: teamSchedules.length,
      epCount: teamEPs.length,
      incidentVolume,
      incidentsPerMonth: Math.round(incidentsPerMonth),
      riskScore,
      shadowStackSignalCount,
      recommendedWave: 0, // assigned below
      effortDays: Math.round(effortDays),
      riskFlags,
    }
  })

  // ── Assign waves (sort by risk ascending) ──
  const sortedTeams = [...teams].sort((a, b) => a.riskScore - b.riskScore)
  const totalTeams = sortedTeams.length
  sortedTeams.forEach((team, idx) => {
    if (totalTeams <= 3) {
      team.recommendedWave = idx + 1
    } else if (idx < Math.ceil(totalTeams * 0.3)) {
      team.recommendedWave = 1 // pilot wave — lowest risk 30%
    } else if (idx < Math.ceil(totalTeams * 0.7)) {
      team.recommendedWave = 2 // main wave — middle 40%
    } else {
      team.recommendedWave = 3 // final wave — highest risk 30%
    }
  })

  // Write wave assignments back to teams array
  sortedTeams.forEach(st => {
    const team = teams.find(t => t.teamId === st.teamId)
    if (team) team.recommendedWave = st.recommendedWave
  })

  // ── Pilot recommendations ──
  const pilotCandidates = [...teams]
    .sort((a, b) => a.riskScore - b.riskScore)
    .slice(0, 3)

  const pilotRecommendations: PilotRecommendation[] = pilotCandidates.map((team, idx) => {
    const reasons: string[] = []
    if (team.riskScore <= 3) reasons.push('low risk profile')
    if (team.serviceCount <= 10) reasons.push(`manageable service count (${team.serviceCount})`)
    if (team.shadowStackSignalCount === 0) reasons.push('no shadow stack dependencies')
    if (team.incidentsPerMonth < 50) reasons.push('low incident volume')
    if (team.scheduleCount > 0) reasons.push('has active on-call schedules')

    return {
      teamId: team.teamId,
      teamName: team.teamName,
      reason: reasons.length > 0
        ? `Recommended as pilot #${idx + 1}: ${reasons.join(', ')}.`
        : `Lowest complexity team — good starting point for migration.`,
      score: 10 - team.riskScore,
      serviceCount: team.serviceCount,
      incidentsPerMonth: team.incidentsPerMonth,
    }
  })

  // ── Build phases (aligned with Enterprise Migration Playbook) ──
  const wave1Teams = teams.filter(t => t.recommendedWave === 1).map(t => t.teamName)
  const wave2Teams = teams.filter(t => t.recommendedWave === 2).map(t => t.teamName)
  const wave3Teams = teams.filter(t => t.recommendedWave === 3).map(t => t.teamName)

  const totalEffortDays = teams.reduce((sum, t) => sum + t.effortDays, 0)
  const shadowItems = shadowStackAnalysis.signals.length

  const phases: ProjectPhase[] = [
    {
      phase: 1,
      name: 'Discovery & Foundation',
      duration: 'Weeks 1–8',
      description: 'Stand up incident.io, build service catalog, configure SSO/RBAC, connect monitoring integrations in parallel. Complete shadow stack mapping.',
      teams: ['All teams (platform-level)'],
      tasks: [
        'Provision incident.io instance and configure SSO',
        'Import service catalog from PagerDuty config snapshot',
        'Enrich catalog with ownership data (Backstage/CMDB/manual)',
        'Connect monitoring integrations in parallel (PD stays primary)',
        'Validate alert routing matches current PD configuration',
        'Map shadow stack components and assign to migration phases',
      ],
      effortDays: Math.ceil(totalEffortDays * 0.15) + 5, // foundation overhead
    },
    {
      phase: 2,
      name: 'On-Call Migration',
      duration: 'Weeks 9–16',
      description: `Migrate on-call scheduling via schedule mirroring. Wave 1 (pilot): ${wave1Teams.join(', ') || 'TBD'}. Wave 2: ${wave2Teams.join(', ') || 'TBD'}. Wave 3: ${wave3Teams.join(', ') || 'TBD'}.`,
      teams: [...wave1Teams, ...wave2Teams, ...wave3Teams],
      tasks: [
        `Wave 1 (Pilot): Import schedules for ${wave1Teams.join(', ') || 'pilot teams'}`,
        'Enable schedule mirroring — validate parity for 1-2 weeks',
        'Switch pilot teams to incident.io primary, PD as backup',
        `Wave 2: Roll out to ${wave2Teams.length} team${wave2Teams.length !== 1 ? 's' : ''}`,
        `Wave 3: Migrate remaining ${wave3Teams.length} high-complexity team${wave3Teams.length !== 1 ? 's' : ''}`,
        'Verify zero missed pages across all waves',
      ],
      effortDays: Math.ceil(totalEffortDays * 0.35),
    },
    {
      phase: 3,
      name: 'Workflow & Shadow Stack Replacement',
      duration: 'Weeks 17–24',
      description: `Migrate incident workflows, replace ${shadowItems} shadow stack component${shadowItems !== 1 ? 's' : ''} with incident.io native features. Decommission custom tooling.`,
      teams: ['All teams'],
      tasks: [
        'Map incident workflows to incident.io workflow builder',
        'Replace custom Slack/Teams bots with native integration',
        'Repoint enrichment pipelines to Catalog + Workflows',
        'Migrate Event Orchestration routing rules to alert routes',
        'Decommission outbound webhooks (replace with Workflow actions)',
        'Update Terraform modules to incident.io provider',
      ],
      effortDays: Math.ceil(totalEffortDays * 0.35) + (shadowItems * 2),
    },
    {
      phase: 4,
      name: 'Cutover & Decommission',
      duration: 'Weeks 25–28',
      description: 'Remove all PagerDuty dependencies, complete contractual exit, establish incident.io as sole platform.',
      teams: ['All teams'],
      tasks: [
        'Final audit: verify no active PD API consumers',
        'Export historical PD data for compliance/archival',
        'Remove PD SSO/SCIM integration from IdP',
        'Revoke all PD API keys',
        'Update internal documentation — replace PD references',
        'Send PD non-renewal notice to procurement',
      ],
      effortDays: Math.ceil(totalEffortDays * 0.15),
    },
  ]

  // ── Shadow stack replacement roadmap ──
  const shadowStackRoadmap: ShadowStackRoadmapItem[] = shadowStackAnalysis.signals.map(signal => {
    // Assign signals to phases based on type
    let phase = 3 // default: Phase 3
    let phaseName = 'Workflow & Shadow Stack'

    if (signal.type === 'eo_routing_layer') {
      phase = 2
      phaseName = 'On-Call Migration'
    } else if (signal.type === 'terraform_consumer') {
      phase = 3
      phaseName = 'Workflow & Shadow Stack'
    } else if (signal.type === 'auto_ack' || signal.type === 'auto_resolve') {
      phase = 2
      phaseName = 'On-Call Migration'
    }

    return {
      signalType: signal.type,
      description: signal.description,
      phase,
      phaseName,
      effort: signal.incidentIoReplacement.effort,
      incidentIoFeature: signal.incidentIoReplacement.feature,
    }
  })

  // ── Overall timeline ──
  const complexity = riskAnalysis.overallComplexity
  const complexityToMonths: Record<string, number> = {
    LOW: 4,
    MEDIUM: 5,
    HIGH: 7,
    VERY_HIGH: 9,
  }
  const estimatedMonths = complexityToMonths[complexity] || 7

  return {
    teams,
    pilotRecommendations,
    overallTimeline: {
      totalWeeks: estimatedMonths * 4,
      totalEffortDays,
      complexity: complexity === 'LOW' ? 'SIMPLE'
        : complexity === 'MEDIUM' ? 'MODERATE'
        : complexity === 'HIGH' ? 'COMPLEX'
        : 'VERY_COMPLEX',
      estimatedMonths,
    },
    phases,
    shadowStackRoadmap,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseEffortToDays(effort: string): number {
  const lower = effort.toLowerCase().trim()
  // Handle "Low", "Medium", "High" text estimates
  if (lower === 'low') return 0.5
  if (lower === 'medium') return 2
  if (lower === 'high') return 5
  if (lower.includes('medium-high')) return 3

  // Handle "2d", "4h", "1w" format
  const match = lower.match(/(\d+(?:\.\d+)?)\s*(d|h|w|day|hour|week)/i)
  if (match) {
    const value = parseFloat(match[1])
    const unit = match[2].toLowerCase()
    if (unit === 'h' || unit === 'hour') return value / 8
    if (unit === 'w' || unit === 'week') return value * 5
    return value // days
  }

  return 1 // default 1 day
}
