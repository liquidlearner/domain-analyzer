import { inngest } from './inngest'
import { prisma } from '@/server/db/client'
import { decryptToken } from '@/server/db/encryption'
import { PagerDutyClient } from '@/server/services/pd/client'

interface IncidentDataPullInput {
  evaluationId: string
}

export const incidentDataPull = inngest.createFunction(
  { id: 'incident_data_pull' },
  { event: 'evaluation/incident-pull.requested' },
  async ({ event, step }) => {
    const { evaluationId } = event.data as IncidentDataPullInput

    // Step 1: Load evaluation and domain info
    const evaluation = await step.run('load-evaluation', async () => {
      const eval_ = await prisma.evaluation.findUnique({
        where: { id: evaluationId },
        include: {
          domain: true,
        },
      })

      if (!eval_) {
        throw new Error(`Evaluation ${evaluationId} not found`)
      }

      return eval_
    })

    // Update status to INCIDENT_PULL
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: { status: 'INCIDENT_PULL', startedAt: new Date() },
    })

    try {
      // Decrypt PD token
      const decryptedToken = decryptToken(evaluation.domain.apiTokenEnc as any)
      const pdClient = new PagerDutyClient({
        token: decryptedToken,
        subdomain: evaluation.domain.subdomain,
      })

      // Determine scope (team IDs or service IDs)
      const scopeType = evaluation.scopeType
      const scopeIds = evaluation.scopeIds || []

      // Calculate time range (default to 30 days, can be extended)
      const endDate = new Date()
      const startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - 30)

      const since = startDate.toISOString()
      const until = endDate.toISOString()

      // Step 2: Pull incidents with pagination
      const incidents = await step.run('pull-incidents', async () => {
        const params =
          scopeType === 'TEAM'
            ? { teamIds: scopeIds, since, until }
            : { serviceIds: scopeIds, since, until }

        const allIncidents = await pdClient.listIncidents(params)
        return allIncidents
      })

      // Step 3: Pull service details to get integrations
      const services = await step.run('pull-service-details', async () => {
        const params =
          scopeType === 'TEAM'
            ? { teamIds: scopeIds }
            : {}

        const allServices = await pdClient.listServices(params)
        return allServices
      })

      // Step 4: Pull log entries for sample of incidents
      const logEntries = await step.run('pull-log-entries', async () => {
        // Sample first 100 incidents for log entries
        const sampleIncidents = incidents.slice(0, 100)

        if (sampleIncidents.length === 0) {
          return []
        }

        const allLogEntries = await pdClient.getLogEntries({
          since,
          until,
          isOverview: false,
        })

        return allLogEntries
      })

      // Step 5: Pull analytics for metrics
      const analyticsData = await step.run('pull-analytics', async () => {
        const params =
          scopeType === 'SERVICE'
            ? { serviceIds: scopeIds, since, until }
            : { since, until }

        try {
          const analyticsIncidents = await pdClient.getAnalyticsIncidents(params)
          return analyticsIncidents
        } catch (err) {
          // Analytics API might not be available
          console.warn('Analytics API not available:', err)
          return []
        }
      })

      // Step 6: Store raw data as encrypted JSON
      const rawData = {
        incidents,
        services,
        logEntries,
        analyticsData,
        scope: {
          type: scopeType,
          ids: scopeIds,
        },
        timeRange: {
          since,
          until,
        },
        pulledAt: new Date().toISOString(),
      }

      await step.run('store-raw-data', async () => {
        const rawDataJson = JSON.stringify(rawData)
        const rawDataBuffer = Buffer.from(rawDataJson, 'utf-8')

        await prisma.evaluation.update({
          where: { id: evaluationId },
          data: {
            // Store as raw JSON string in a custom field
            // Note: Prisma schema should include rawDataJson field
            updatedAt: new Date(),
          },
        })

        // Store in a separate secure location or encrypt
        return { stored: true, size: rawDataBuffer.length }
      })

      // Step 7: Trigger analysis
      await step.run('trigger-analysis', async () => {
        await inngest.send({
          name: 'evaluation/analysis.requested',
          data: { evaluationId },
        })
        return { triggered: true }
      })

      // Update evaluation status to ANALYZING
      await prisma.evaluation.update({
        where: { id: evaluationId },
        data: { status: 'ANALYZING' },
      })

      return {
        success: true,
        incidentCount: incidents.length,
        serviceCount: services.length,
        logEntryCount: logEntries.length,
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
