import { inngest } from './inngest'
import { prisma } from '@/server/db/client'
import { jobProgress } from '@/server/services/job-progress'

interface ConversionAnalysisInput {
  snapshotId: string
}

interface TerraformResource {
  name: string
  type: string
  attributes: Record<string, unknown>
}

interface TerraformState {
  version: number
  terraform_version: string
  serial: number
  lineage: string
  outputs: Record<string, unknown>
  resources: TerraformResource[]
}

const conversionMappings: Record<
  string,
  {
    status: 'AUTO' | 'MANUAL' | 'SKIP' | 'UNSUPPORTED'
    ioResourceType: string
    effort: 'Low' | 'Medium' | 'High'
    notes: string
  }
> = {
  SCHEDULE: {
    status: 'AUTO',
    ioResourceType: 'incident_schedule',
    effort: 'Low',
    notes: 'Direct mapping to incident.io schedules',
  },
  ESCALATION_POLICY: {
    status: 'AUTO',
    ioResourceType: 'incident_escalation_path',
    effort: 'Low',
    notes: 'Direct mapping to incident.io escalation paths',
  },
  TEAM: {
    status: 'AUTO',
    ioResourceType: 'incident_catalog_entry',
    effort: 'Low',
    notes: 'Teams mapped as catalog entries with team type',
  },
  USER: {
    status: 'SKIP',
    ioResourceType: '',
    effort: 'Low',
    notes: 'Users provisioned via SSO/SCIM, not Terraform',
  },
  SERVICE: {
    status: 'MANUAL',
    ioResourceType: 'incident_catalog_entry + alert routes',
    effort: 'Medium',
    notes:
      'Services require manual mapping to catalog entries and alert routing configuration',
  },
  BUSINESS_SERVICE: {
    status: 'MANUAL',
    ioResourceType: 'incident_catalog_entry',
    effort: 'Medium',
    notes:
      'Business services mapped as custom catalog entries, may require custom attributes',
  },
  RULESET: {
    status: 'UNSUPPORTED',
    ioResourceType: '',
    effort: 'High',
    notes:
      'Event Orchestration rules require manual workflow translation, no direct mapping',
  },
}

export const conversionAnalysis = inngest.createFunction(
  { id: 'conversion_analysis', retries: 3 },
  { event: 'config/conversion-analysis.requested' },
  async ({ event, step }) => {
    const { snapshotId } = event.data as ConversionAnalysisInput

    try {
      // Get snapshot to know which domain we're working with
      const snapshot = await prisma.configSnapshot.findUnique({
        where: { id: snapshotId },
        include: { domain: true },
      })

      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`)
      }

      const jobId = snapshot.domainId

      jobProgress.updateProgress(jobId, {
        status: 'running',
        progress: 0,
        message: 'Starting conversion analysis',
      })

      // Step 1: Load resources
      const resources = await step.run('load-resources', async () => {
        const pdResources = await prisma.pdResource.findMany({
          where: { snapshotId },
        })

        jobProgress.updateProgress(jobId, {
          status: 'running',
          progress: 20,
          message: `Loaded ${pdResources.length} resources`,
        })

        return pdResources
      })

      // Step 2: Analyze conversions
      const mappings = await step.run('analyze-conversions', async () => {
        const result = []

        for (const resource of resources) {
          const mapping = conversionMappings[resource.pdType]
          if (!mapping) {
            throw new Error(`Unknown resource type: ${resource.pdType}`)
          }

          result.push({
            pdResource: resource,
            mapping,
          })
        }

        jobProgress.updateProgress(jobId, {
          status: 'running',
          progress: 40,
          message: `Analyzed ${result.length} resources`,
        })

        return result
      })

      // Step 3: Generate Terraform snippets for AUTO resources
      const tfSnippets = await step.run('generate-tf-snippets', async () => {
        const snippets: Record<string, string> = {}

        for (const { pdResource, mapping } of mappings) {
          if (mapping.status !== 'AUTO') {
            continue
          }

          const safeName = pdResource.name
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')

          const configJson = JSON.parse(pdResource.configJson.toString('utf8'))

          switch (pdResource.pdType) {
            case 'SCHEDULE': {
              const snippet = `resource "incident_schedule" "${safeName}" {
  name        = "${pdResource.name}"
  description = "Migrated from PagerDuty schedule ${pdResource.pdId}"
  timezone    = "UTC"
  
  # Configure schedule layers based on PagerDuty schedule configuration
  # layers = [
  #   {
  #     name      = "Layer 1"
  #     start     = "2024-01-01T00:00:00Z"
  #     rotation_set_id = incident_rotation_set.example.id
  #   }
  # ]
}`
              snippets[pdResource.id] = snippet
              break
            }

            case 'ESCALATION_POLICY': {
              const snippet = `resource "incident_escalation_path" "${safeName}" {
  name        = "${pdResource.name}"
  description = "Migrated from PagerDuty escalation policy ${pdResource.pdId}"
  
  # Configure escalation steps based on PagerDuty policy
  # escalation_steps = [
  #   {
  #     delay_seconds = 300
  #     targets = [
  #       {
  #         id   = incident_schedule.example.id
  #         type = "schedule"
  #       }
  #     ]
  #   }
  # ]
}`
              snippets[pdResource.id] = snippet
              break
            }

            case 'TEAM': {
              const snippet = `resource "incident_catalog_entry" "${safeName}" {
  name         = "${pdResource.name}"
  description  = "Team migrated from PagerDuty"
  catalog_type_id = "team"
  
  attributes = {
    # Map team attributes as needed
  }
}`
              snippets[pdResource.id] = snippet
              break
            }
          }
        }

        jobProgress.updateProgress(jobId, {
          status: 'running',
          progress: 60,
          message: `Generated ${Object.keys(snippets).length} Terraform snippets`,
        })

        return snippets
      })

      // Step 4: Store mappings
      await step.run('store-mappings', async () => {
        let successCount = 0
        let skipCount = 0
        let unsupportedCount = 0
        let manualCount = 0

        for (const { pdResource, mapping } of mappings) {
          const snippet = tfSnippets[pdResource.id]

          const conversionStatus = (() => {
            if (mapping.status === 'AUTO') return 'AUTO'
            if (mapping.status === 'MANUAL') return 'MANUAL'
            if (mapping.status === 'SKIP') return 'SKIP'
            return 'UNSUPPORTED'
          })()

          await prisma.migrationMapping.create({
            data: {
              evaluationId: snapshot.domainId,
              pdResourceId: pdResource.id,
              ioResourceType: mapping.ioResourceType || null,
              conversionStatus,
              effortEstimate: mapping.effort,
              notes: mapping.notes,
              ioTfSnippet: snippet || null,
            },
          })

          if (mapping.status === 'AUTO') successCount++
          else if (mapping.status === 'MANUAL') manualCount++
          else if (mapping.status === 'SKIP') skipCount++
          else unsupportedCount++
        }

        jobProgress.updateProgress(jobId, {
          status: 'running',
          progress: 80,
          message: `Created mappings: ${successCount} AUTO, ${manualCount} MANUAL, ${skipCount} SKIP, ${unsupportedCount} UNSUPPORTED`,
        })

        return {
          successCount,
          manualCount,
          skipCount,
          unsupportedCount,
        }
      })

      // Step 5: Update snapshot status
      await step.run('update-status', async () => {
        await prisma.configSnapshot.update({
          where: { id: snapshotId },
          data: {
            status: 'COMPLETED',
          },
        })

        jobProgress.updateProgress(jobId, {
          status: 'completed',
          progress: 100,
          message: 'Conversion analysis completed successfully',
        })
      })

      return { success: true, snapshotId }
    } catch (error) {
      const snapshot = await prisma.configSnapshot.findUnique({
        where: { id: snapshotId },
        include: { domain: true },
      })

      if (snapshot) {
        const jobId = snapshot.domainId
        const errorMessage = error instanceof Error ? error.message : String(error)

        jobProgress.updateProgress(jobId, {
          status: 'failed',
          progress: 0,
          message: `Conversion analysis failed: ${errorMessage}`,
        })

        await prisma.configSnapshot.update({
          where: { id: snapshotId },
          data: { status: 'FAILED' },
        })
      }

      throw error
    }
  }
)
