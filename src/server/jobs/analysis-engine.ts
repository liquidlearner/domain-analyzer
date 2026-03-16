import { inngest } from './inngest'
import { prisma } from '@/server/db/client'
import { analyzeVolume } from '@/server/services/analysis/volume'
import { analyzeNoise } from '@/server/services/analysis/noise'
import { analyzeSources } from '@/server/services/analysis/sources'
import { analyzeShadowStack } from '@/server/services/analysis/shadow-stack'
import { analyzeRisk } from '@/server/services/analysis/risk'

interface AnalysisEngineInput {
  evaluationId: string
}

export const analysisEngine = inngest.createFunction(
  { id: 'analysis_engine' },
  { event: 'evaluation/analysis.requested' },
  async ({ event, step }) => {
    const { evaluationId } = event.data as AnalysisEngineInput

    // Step 1: Load evaluation and raw data
    const evaluationData = await step.run('load-data', async () => {
      const evaluation = await prisma.evaluation.findUnique({
        where: { id: evaluationId },
        include: {
          domain: true,
          configSnapshot: {
            include: {
              resources: true,
            },
          },
        },
      })

      if (!evaluation) {
        throw new Error(`Evaluation ${evaluationId} not found`)
      }

      // TODO: Retrieve raw incident data that was stored in step 6 of incident-data-pull
      // For now, we'll assume it's stored in a separate field or external store
      const rawDataJson = '' // Placeholder - should be retrieved from storage
      const rawData = rawDataJson ? JSON.parse(rawDataJson) : { incidents: [], services: [], logEntries: [] }

      return {
        evaluation,
        incidents: rawData.incidents || [],
        services: rawData.services || [],
        logEntries: rawData.logEntries || [],
      }
    })

    const { evaluation, incidents, services, logEntries } = evaluationData

    try {
      // Build integrations map
      const integrationsMap = new Map<string, any[]>()
      services.forEach((svc: any) => {
        integrationsMap.set(svc.id, svc.integrations || [])
      })

      // Step 2: Volume analysis
      const volumeAnalysis = await step.run('analyze-volume', async () => {
        return analyzeVolume(incidents, services)
      })

      // Step 3: Noise analysis
      const noiseAnalysis = await step.run('analyze-noise', async () => {
        return analyzeNoise(incidents, logEntries)
      })

      // Step 4: Source identification
      const sourceAnalysis = await step.run('analyze-sources', async () => {
        return analyzeSources(incidents, services, integrationsMap)
      })

      // Step 5: Shadow stack detection
      const shadowStackAnalysis = await step.run('analyze-shadow-stack', async () => {
        const resources = evaluation.configSnapshot?.resources || []
        return analyzeShadowStack(incidents, logEntries, services, integrationsMap)
      })

      // Step 6: Risk analysis
      const riskAnalysis = await step.run('analyze-risk', async () => {
        const resources = evaluation.configSnapshot?.resources || []
        const periodDays = 30 // Default to 30 days
        return analyzeRisk(
          volumeAnalysis,
          noiseAnalysis,
          shadowStackAnalysis,
          resources,
          periodDays
        )
      })

      // Step 7: Store results
      await step.run('store-results', async () => {
        // Store volume analysis
        const volumeAnalysisJson = JSON.stringify(volumeAnalysis)

        // Store noise patterns
        const noisePatterns = {
          autoResolvedPercent: noiseAnalysis.autoResolvedPercent,
          ackNoActionPercent: noiseAnalysis.ackNoActionPercent,
          escalatedPercent: noiseAnalysis.escalatedPercent,
          transientAlerts: noiseAnalysis.transientAlerts,
        }
        const noisePatternsJson = JSON.stringify(noisePatterns)

        // Store sources
        const sourcesJson = JSON.stringify(sourceAnalysis.sources)

        // Store shadow signals
        const shadowSignals = shadowStackAnalysis.signals.map((s) => s.type)

        // Create or update incident analysis records
        await prisma.incidentAnalysis.upsert({
          where: {
            evaluationId_periodStart_periodEnd: {
              evaluationId,
              periodStart: new Date(new Date().setDate(new Date().getDate() - 30)),
              periodEnd: new Date(),
            },
          },
          create: {
            evaluationId,
            serviceId: undefined,
            teamId: undefined,
            periodStart: new Date(new Date().setDate(new Date().getDate() - 30)),
            periodEnd: new Date(),
            incidentCount: volumeAnalysis.totalIncidents,
            alertCount: volumeAnalysis.totalAlerts,
            noiseRatio: noiseAnalysis.overallNoiseRatio,
            mttrP50: undefined,
            mttrP95: undefined,
            sourcesJson: Buffer.from(sourcesJson),
            patternsJson: Buffer.from(noisePatternsJson),
            shadowSignals,
          },
          update: {
            incidentCount: volumeAnalysis.totalIncidents,
            alertCount: volumeAnalysis.totalAlerts,
            noiseRatio: noiseAnalysis.overallNoiseRatio,
            sourcesJson: Buffer.from(sourcesJson),
            patternsJson: Buffer.from(noisePatternsJson),
            shadowSignals,
          },
        })

        // Update evaluation status to COMPLETED
        await prisma.evaluation.update({
          where: { id: evaluationId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        })

        return {
          analysesCreated: 1,
          riskComplexity: riskAnalysis.overallComplexity,
        }
      })

      return {
        success: true,
        evaluation: evaluationId,
        results: {
          volumeAnalysis,
          noiseAnalysis,
          sourceAnalysis,
          shadowStackAnalysis,
          riskAnalysis,
        },
      }
    } catch (error) {
      // Update status to FAILED on error
      await prisma.evaluation.update({
        where: { id: evaluationId },
        data: { status: 'FAILED' },
      })

      throw error
    }
  }
)
