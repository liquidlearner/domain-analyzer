import type { VolumeAnalysis } from './volume'
import type { NoiseAnalysis } from './noise'
import type { ShadowStackAnalysis } from './shadow-stack'

export interface RiskAnalysis {
  overallComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
  signals: { type: string; severity: 'low' | 'medium' | 'high'; description: string; affectedServices: string[] }[]
  highVolumeServices: string[]
  complexEoServices: string[]
  shadowStackDependencies: string[]
  uniqueScheduleTeams: string[]
}

export function analyzeRisk(
  volumeAnalysis: VolumeAnalysis,
  noiseAnalysis: NoiseAnalysis,
  shadowStackAnalysis: ShadowStackAnalysis,
  resources: any[],
  periodDays: number
): RiskAnalysis {
  const signals: RiskAnalysis['signals'] = []
  const highVolumeServices: Set<string> = new Set()
  const complexEoServices: Set<string> = new Set()
  const shadowStackDependencies: Set<string> = new Set()
  const uniqueScheduleTeams: Set<string> = new Set()

  // Calculate incidents per month
  const incidentsPerMonth = (volumeAnalysis.totalIncidents / periodDays) * 30

  // Risk 1: High volume services (>100 incidents/month)
  volumeAnalysis.incidentsByService.forEach((item) => {
    const itemIncidentsPerMonth = (item.count / periodDays) * 30
    if (itemIncidentsPerMonth > 100) {
      highVolumeServices.add(item.serviceName)
      signals.push({
        type: 'high_incident_volume',
        severity: 'high',
        description: `${item.serviceName} generates ~${Math.round(itemIncidentsPerMonth)} incidents/month`,
        affectedServices: [item.serviceName],
      })
    }
  })

  // Risk 2: High noise ratio indicates poor alert quality
  if (noiseAnalysis.overallNoiseRatio > 0.5) {
    signals.push({
      type: 'high_noise_ratio',
      severity: 'high',
      description: `Alert quality is poor: ${(noiseAnalysis.overallNoiseRatio * 100).toFixed(1)}% noise ratio`,
      affectedServices: volumeAnalysis.topNoisiest.map((s) => s.serviceName),
    })
  }

  // Risk 3: Low mean time to acknowledge indicates insufficient coverage
  if (noiseAnalysis.meanTimeToAck > 3600) {
    // > 1 hour
    signals.push({
      type: 'slow_ack_time',
      severity: 'medium',
      description: `Mean time to acknowledge is ${(noiseAnalysis.meanTimeToAck / 60).toFixed(1)} minutes`,
      affectedServices: [],
    })
  }

  // Risk 4: Complex Event Orchestration rules
  const complexEoRulesets = resources.filter((res: any) => {
    try {
      if (res.pdType !== 'RULESET' || !res.configJson) return false
      const raw = res.configJson
      const config = Buffer.isBuffer(raw)
        ? JSON.parse(raw.toString('utf-8'))
        : typeof raw === 'string'
          ? JSON.parse(raw)
          : raw
      return config?.routing_keys?.length > 5
    } catch {
      return false
    }
  })

  complexEoRulesets.forEach((ruleset: any) => {
    complexEoServices.add(ruleset.name)
    signals.push({
      type: 'complex_eo_rules',
      severity: 'medium',
      description: `Complex Event Orchestration ruleset "${ruleset.name}" with multiple routing keys`,
      affectedServices: [ruleset.name],
    })
  })

  // Risk 5: Shadow stack dependencies
  shadowStackAnalysis.signals.forEach((sig) => {
    if (sig.serviceName) {
      shadowStackDependencies.add(sig.serviceName)
    }
  })

  if (shadowStackAnalysis.apiConsumerCount > 0) {
    signals.push({
      type: 'custom_api_integrations',
      severity: 'high',
      description: `${shadowStackAnalysis.apiConsumerCount} custom API integrations detected`,
      affectedServices: Array.from(shadowStackDependencies),
    })
  }

  if (shadowStackAnalysis.webhookDestinationCount > 0) {
    signals.push({
      type: 'outbound_webhooks',
      severity: 'medium',
      description: `${shadowStackAnalysis.webhookDestinationCount} outbound webhook destinations`,
      affectedServices: Array.from(shadowStackDependencies),
    })
  }

  // Risk 6: Complex escalation structures
  const escalationPolicies = resources.filter((res: any) => res.pdType === 'ESCALATION_POLICY')
  const complexEsps = escalationPolicies.filter((ep: any) => {
    try {
      const raw = ep.configJson
      const configJson = Buffer.isBuffer(raw)
        ? JSON.parse(raw.toString('utf-8'))
        : typeof raw === 'string'
          ? JSON.parse(raw)
          : raw
      if (!configJson) return false
      return configJson.escalation_rules?.length > 5 || configJson.num_loops > 2
    } catch {
      return false
    }
  })

  if (complexEsps.length > 0) {
    signals.push({
      type: 'complex_escalation',
      severity: 'medium',
      description: `${complexEsps.length} escalation policies with complex rules (>5 levels or >2 loops)`,
      affectedServices: complexEsps.map((ep: any) => ep.name),
    })
  }

  // Risk 7: Multiple schedules per team (unique schedule assignments)
  const scheduleTeams = new Map<string, Set<string>>()
  resources
    .filter((res: any) => res.pdType === 'SCHEDULE')
    .forEach((schedule: any) => {
      (schedule.teamIds || []).forEach((teamId: string) => {
        if (!scheduleTeams.has(teamId)) {
          scheduleTeams.set(teamId, new Set())
        }
        scheduleTeams.get(teamId)!.add(schedule.id)
      })
    })

  scheduleTeams.forEach((scheduleIds, teamId) => {
    if (scheduleIds.size > 3) {
      uniqueScheduleTeams.add(teamId)
      signals.push({
        type: 'complex_on_call_schedule',
        severity: 'low',
        description: `Team has ${scheduleIds.size} different on-call schedules`,
        affectedServices: [teamId],
      })
    }
  })

  // Determine overall complexity
  let overallComplexity: RiskAnalysis['overallComplexity'] = 'LOW'
  const highSeveritySignals = signals.filter((s) => s.severity === 'high').length
  const mediumSeveritySignals = signals.filter((s) => s.severity === 'medium')
    .length

  if (highSeveritySignals >= 3) {
    overallComplexity = 'VERY_HIGH'
  } else if (highSeveritySignals >= 2 || mediumSeveritySignals >= 4) {
    overallComplexity = 'HIGH'
  } else if (highSeveritySignals >= 1 || mediumSeveritySignals >= 2) {
    overallComplexity = 'MEDIUM'
  }

  return {
    overallComplexity,
    signals,
    highVolumeServices: Array.from(highVolumeServices),
    complexEoServices: Array.from(complexEoServices),
    shadowStackDependencies: Array.from(shadowStackDependencies),
    uniqueScheduleTeams: Array.from(uniqueScheduleTeams),
  }
}
