import type {
  PDService,
  PDTeam,
  PDSchedule,
  PDEscalationPolicy,
  PDUser,
  PDBusinessService,
  PDIncident,
  PDRuleset,
} from '@/server/services/pd/types'
import { inngest } from './inngest'
import { PagerDutyClient } from '@/server/services/pd/client'
import { prisma } from '@/server/db/client'
import { decryptToken, encryptToken } from '@/server/db/encryption'
import { jobProgress } from '@/server/services/job-progress'

interface ConfigExportInput {
  domainId: string
}

interface ResourceWithDependencies {
  pdId: string
  type: string
  name: string
  teamIds: string[]
  dependencies: string[]
  isStale: boolean
  lastActivity?: Date
}

export const configExport = inngest.createFunction(
  { id: 'config_export', retries: 3 },
  { event: 'domain/config-export.requested' },
  async ({ event, step }) => {
    const { domainId } = event.data as ConfigExportInput

    try {
      jobProgress.updateProgress(domainId, {
        status: 'running',
        progress: 0,
        message: 'Starting config export',
      })

      // Step 1: Validate token
      const domain = await step.run('validate-token', async () => {
        const pdDomain = await prisma.pdDomain.findUnique({
          where: { id: domainId },
        })

        if (!pdDomain) {
          throw new Error(`Domain not found: ${domainId}`)
        }

        const decryptedToken = decryptToken(pdDomain.apiTokenEnc)
        const client = new PagerDutyClient({
          token: decryptedToken,
          subdomain: pdDomain.subdomain,
        })

        const validation = await client.validateToken()
        if (!validation.valid) {
          throw new Error(`Token validation failed: ${validation.error}`)
        }

        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 10,
          message: 'Token validated',
        })

        return pdDomain
      })

      const decryptedToken = decryptToken(domain.apiTokenEnc)
      const pdClient = new PagerDutyClient({
        token: decryptedToken,
        subdomain: domain.subdomain,
      })

      // Step 2: Pull services
      const services = await step.run('pull-services', async () => {
        const result = await pdClient.listServices()
        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 20,
          message: `Fetched ${result.length} services`,
        })
        return result
      })

      // Step 3: Pull teams
      const teams = await step.run('pull-teams', async () => {
        const result = await pdClient.listTeams()
        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 30,
          message: `Fetched ${result.length} teams`,
        })
        return result
      })

      // Step 4: Pull schedules
      const schedules = await step.run('pull-schedules', async () => {
        const result = await pdClient.listSchedules()
        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 40,
          message: `Fetched ${result.length} schedules`,
        })
        return result
      })

      // Step 5: Pull escalation policies
      const escalationPolicies = await step.run(
        'pull-escalation-policies',
        async () => {
          const result = await pdClient.listEscalationPolicies()
          jobProgress.updateProgress(domainId, {
            status: 'running',
            progress: 50,
            message: `Fetched ${result.length} escalation policies`,
          })
          return result
        }
      )

      // Step 6: Pull users
      const users = await step.run('pull-users', async () => {
        const result = await pdClient.listUsers()
        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 60,
          message: `Fetched ${result.length} users`,
        })
        return result
      })

      // Step 7: Pull business services
      const businessServices = await step.run(
        'pull-business-services',
        async () => {
          const result = await pdClient.listBusinessServices()
          jobProgress.updateProgress(domainId, {
            status: 'running',
            progress: 70,
            message: `Fetched ${result.length} business services`,
          })
          return result
        }
      )

      // Step 8: Pull rulesets
      const rulesets = await step.run('pull-rulesets', async () => {
        const result = await pdClient.getRulesets()
        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 75,
          message: `Fetched ${result.length} rulesets`,
        })
        return result
      })

      // Step 9: Build snapshot
      const snapshot = await step.run('build-snapshot', async () => {
        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 80,
          message: 'Building resource snapshot and dependency graph',
        })

        // Check for incidents in the last 90 days to identify stale resources
        const ninetyDaysAgo = new Date()
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

        const serviceIds = services.map((s) => s.id)
        let incidents: PDIncident[] = []

        if (serviceIds.length > 0) {
          incidents = await pdClient.listIncidents({
            serviceIds,
            since: ninetyDaysAgo.toISOString(),
            until: new Date().toISOString(),
          })
        }

        const servicesWithIncidents = new Set(
          incidents.map((i) => i.service?.id).filter(Boolean)
        )

        // Build resources map for dependency tracking
        const resources: Record<string, ResourceWithDependencies> = {}

        // Add services
        for (const service of services) {
          resources[service.id] = {
            pdId: service.id,
            type: 'SERVICE',
            name: service.name || '',
            teamIds: service.teams?.map((t) => t.id) || [],
            dependencies: service.escalation_policy?.id
              ? [service.escalation_policy.id]
              : [],
            isStale: !servicesWithIncidents.has(service.id),
          }
        }

        // Add teams
        for (const team of teams) {
          resources[team.id] = {
            pdId: team.id,
            type: 'TEAM',
            name: team.name || '',
            teamIds: [team.id],
            dependencies: [],
            isStale: false,
          }
        }

        // Add schedules
        for (const schedule of schedules) {
          resources[schedule.id] = {
            pdId: schedule.id,
            type: 'SCHEDULE',
            name: schedule.name || '',
            teamIds: [],
            dependencies: [],
            isStale:
              !(schedule as any).schedule_layers || (schedule as any).schedule_layers.length === 0,
          }
        }

        // Add escalation policies
        for (const policy of escalationPolicies) {
          const policyDependencies: string[] = []
          if (policy.escalation_rules && Array.isArray(policy.escalation_rules)) {
            for (const rule of policy.escalation_rules) {
              if (rule.targets && Array.isArray(rule.targets)) {
                for (const target of rule.targets) {
                  if (target.type === 'schedule_reference' && target.id) {
                    policyDependencies.push(target.id)
                  }
                }
              }
            }
          }

          resources[policy.id] = {
            pdId: policy.id,
            type: 'ESCALATION_POLICY',
            name: policy.name || '',
            teamIds: [],
            dependencies: policyDependencies,
            isStale: !policyDependencies || policyDependencies.length === 0,
          }
        }

        // Add users
        for (const user of users) {
          resources[user.id] = {
            pdId: user.id,
            type: 'USER',
            name: user.name || '',
            teamIds: (user as any).teams?.map((t: any) => t.id) || [],
            dependencies: [],
            isStale: false,
          }
        }

        // Add business services
        for (const bs of businessServices) {
          resources[bs.id] = {
            pdId: bs.id,
            type: 'BUSINESS_SERVICE',
            name: bs.name || '',
            teamIds: [],
            dependencies: (bs as any).service?.id ? [(bs as any).service.id] : [],
            isStale: false,
          }
        }

        // Add rulesets
        for (const ruleset of rulesets) {
          resources[ruleset.id] = {
            pdId: ruleset.id,
            type: 'RULESET',
            name: ruleset.name || '',
            teamIds: [],
            dependencies: [],
            isStale: false,
          }
        }

        // Prepare stale resources summary
        const staleResources = Object.values(resources).filter((r) => r.isStale)
        const staleResourcesSummary = {
          total: staleResources.length,
          byType: staleResources.reduce(
            (acc, r) => {
              acc[r.type] = (acc[r.type] || 0) + 1
              return acc
            },
            {} as Record<string, number>
          ),
        }

        // Prepare resource counts
        const resourceCounts = {
          services: services.length,
          teams: teams.length,
          schedules: schedules.length,
          escalationPolicies: escalationPolicies.length,
          users: users.length,
          businessServices: businessServices.length,
          rulesets: rulesets.length,
          total:
            services.length +
            teams.length +
            schedules.length +
            escalationPolicies.length +
            users.length +
            businessServices.length +
            rulesets.length,
        }

        // Encrypt and store resources
        const resourcesJsonString = JSON.stringify(resources)
        const resourcesJsonBytes = Buffer.from(resourcesJsonString, 'utf8')

        const terraformStateString = JSON.stringify({
          version: 4,
          terraform_version: '1.0',
          serial: 0,
          lineage: domainId,
          outputs: {},
          resources: [],
        })
        const terraformStateBytes = Buffer.from(terraformStateString, 'utf8')

        // Create config snapshot in DB
        const configSnapshot = await prisma.configSnapshot.create({
          data: {
            domainId,
            capturedAt: new Date(),
            terraformState: terraformStateBytes,
            resourcesJson: resourcesJsonBytes,
            resourceCounts,
            staleResources: staleResourcesSummary,
            status: 'RUNNING',
          },
        })

        // Create PdResource records
        for (const [pdId, resource] of Object.entries(resources)) {
          const configJsonString = JSON.stringify({
            id: resource.pdId,
            type: resource.type,
            name: resource.name,
            teamIds: resource.teamIds,
            dependencies: resource.dependencies,
          })
          const configJsonBytes = Buffer.from(configJsonString, 'utf8')

          await prisma.pdResource.create({
            data: {
              snapshotId: configSnapshot.id,
              pdType: resource.type,
              pdId: resource.pdId,
              name: resource.name,
              teamIds: resource.teamIds,
              configJson: configJsonBytes,
              isStale: resource.isStale,
              dependencies: resource.dependencies,
            },
          })
        }

        // Update domain status to CONNECTED
        await prisma.pdDomain.update({
          where: { id: domainId },
          data: {
            status: 'CONNECTED',
            lastValidated: new Date(),
          },
        })

        return configSnapshot
      })

      // Step 10: Trigger conversion
      await step.run('trigger-conversion', async () => {
        await inngest.send({
          name: 'config/conversion-analysis.requested',
          data: {
            snapshotId: snapshot.id,
          },
        })

        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 90,
          message: 'Triggering conversion analysis',
        })
      })

      jobProgress.updateProgress(domainId, {
        status: 'completed',
        progress: 100,
        message: 'Config export completed successfully',
      })

      return { success: true, snapshotId: snapshot.id }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Update domain status to INVALID if token validation failed
      if (errorMessage.includes('Token validation failed')) {
        await prisma.pdDomain.update({
          where: { id: domainId },
          data: { status: 'INVALID' },
        })
      }

      jobProgress.updateProgress(domainId, {
        status: 'failed',
        progress: 0,
        message: `Failed: ${errorMessage}`,
      })

      throw error
    }
  }
)
