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

      const decryptedToken = decryptToken(domain.apiTokenEnc as any)
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

      // Step 9: Pull extensions (ServiceNow, Slack, JIRA, etc.)
      const extensions = await step.run('pull-extensions', async () => {
        try {
          const result = await pdClient.listExtensions()
          jobProgress.updateProgress(domainId, {
            status: 'running',
            progress: 77,
            message: `Fetched ${result.length} extensions`,
          })
          return result
        } catch {
          return []
        }
      })

      // Step 10: Pull webhook subscriptions
      const webhookSubscriptions = await step.run('pull-webhook-subscriptions', async () => {
        const result = await pdClient.listWebhookSubscriptions()
        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 78,
          message: `Fetched ${result.length} webhook subscriptions`,
        })
        return result
      })

      // Step 11: Pull incident workflows — list first, then fetch detail for each
      const incidentWorkflows = await step.run('pull-incident-workflows', async () => {
        const list = await pdClient.listIncidentWorkflows()
        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 76,
          message: `Fetched ${list.length} incident workflows, pulling step details...`,
        })

        // Fetch full detail (steps + triggers) for each workflow
        // The list endpoint does NOT return steps/triggers
        const detailResults = await Promise.allSettled(
          list.map((wf) => pdClient.getIncidentWorkflowDetail(wf.id))
        )

        const enrichedWorkflows = list.map((wf, i) => {
          const detail = detailResults[i]
          if (detail.status === 'fulfilled' && detail.value) {
            return { ...wf, steps: detail.value.steps, triggers: detail.value.triggers }
          }
          return wf
        })

        jobProgress.updateProgress(domainId, {
          status: 'running',
          progress: 79,
          message: `Fetched ${list.length} incident workflows with step details`,
        })

        return enrichedWorkflows
      })

      // Step 11b: Check for Slack connections (account-level)
      const slackConnections = await step.run('pull-slack-connections', async () => {
        return await pdClient.getSlackConnections()
      })

      // Step 12: Pull Event Orchestrations with router rules (reveals dynamic routing)
      const eventOrchestrations = await step.run('pull-event-orchestrations', async () => {
        try {
          const eos = await pdClient.listEventOrchestrations()
          jobProgress.updateProgress(domainId, {
            status: 'running',
            progress: 79,
            message: `Fetched ${eos.length} event orchestrations, pulling router rules...`,
          })

          // Pull router rules in parallel to discover which services each EO routes to
          const routerResults = await Promise.allSettled(
            eos.map((eo) => pdClient.getOrchestrationRouter(eo.id))
          )

          const enrichedEos = eos.map((eo, i) => {
            const routerResult = routerResults[i]
            const routerRules = routerResult.status === 'fulfilled' ? routerResult.value : null

            // Extract service IDs that this orchestration dynamically routes to
            const routedServiceIds: string[] = []
            if (routerRules?.sets) {
              for (const set of routerRules.sets) {
                for (const rule of (set.rules || [])) {
                  const serviceId = rule?.actions?.route_to?.service?.id
                  if (serviceId) routedServiceIds.push(serviceId)
                }
              }
            }
            // Also check catch_all
            if (routerRules?.catch_all?.actions?.route_to?.service?.id) {
              routedServiceIds.push(routerRules.catch_all.actions.route_to.service.id)
            }

            return {
              ...eo,
              _routerRules: routerRules,
              _routedServiceIds: routedServiceIds,
            }
          })

          jobProgress.updateProgress(domainId, {
            status: 'running',
            progress: 80,
            message: `Fetched ${eos.length} event orchestrations with router rules`,
          })

          return enrichedEos
        } catch {
          return []
        }
      })

      // Step 13: Build snapshot
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

        // Add extensions (ServiceNow, Slack, JIRA, MS Teams, etc.)
        for (const ext of extensions) {
          const extServiceIds = (ext.extension_objects || [])
            .filter((eo: any) => eo.type === 'service_reference')
            .map((eo: any) => eo.id)
          resources[ext.id] = {
            pdId: ext.id,
            type: 'EXTENSION',
            name: ext.name || ext.extension_schema?.summary || 'Extension',
            teamIds: [],
            dependencies: extServiceIds,
            isStale: ext.temporarily_disabled || false,
          }
        }

        // Add webhook subscriptions
        for (const wh of webhookSubscriptions) {
          resources[wh.id] = {
            pdId: wh.id,
            type: 'WEBHOOK_SUBSCRIPTION',
            name: wh.description || `Webhook → ${wh.delivery_method?.url || 'unknown'}`,
            teamIds: [],
            dependencies: wh.filter?.id ? [wh.filter.id] : [],
            isStale: !wh.active,
          }
        }

        // Add incident workflows with full step/trigger detail for integration detection
        for (const wf of incidentWorkflows) {
          resources[wf.id] = {
            pdId: wf.id,
            type: 'INCIDENT_WORKFLOW',
            name: wf.name || 'Incident Workflow',
            teamIds: wf.team?.id ? [wf.team.id] : [],
            dependencies: [],
            isStale: false,
          }
          // Note: full configJson with steps/triggers stored in richConfigMap below
        }

        // Add event orchestrations with router rules (dynamic routing detection)
        for (const eo of eventOrchestrations) {
          const routedServiceIds: string[] = (eo as any)._routedServiceIds || []
          resources[eo.id] = {
            pdId: eo.id,
            type: 'EVENT_ORCHESTRATION',
            name: eo.name || 'Event Orchestration',
            teamIds: eo.team?.id ? [eo.team.id] : [],
            dependencies: routedServiceIds, // Services this EO routes to
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
          extensions: extensions.length,
          webhookSubscriptions: webhookSubscriptions.length,
          incidentWorkflows: incidentWorkflows.length,
          eventOrchestrations: eventOrchestrations.length,
          total:
            services.length +
            teams.length +
            schedules.length +
            escalationPolicies.length +
            users.length +
            businessServices.length +
            rulesets.length +
            extensions.length +
            webhookSubscriptions.length +
            incidentWorkflows.length +
            eventOrchestrations.length,
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

        // Build richer configJson map for specific resource types
        const richConfigMap = new Map<string, any>()
        for (const ext of extensions) {
          richConfigMap.set(ext.id, {
            extension_schema: ext.extension_schema,
            endpoint_url: ext.endpoint_url,
            extension_objects: ext.extension_objects,
            temporarily_disabled: ext.temporarily_disabled,
          })
        }
        for (const wh of webhookSubscriptions) {
          richConfigMap.set(wh.id, {
            delivery_method: wh.delivery_method,
            events: wh.events,
            filter: wh.filter,
            active: wh.active,
          })
        }
        for (const wf of incidentWorkflows) {
          richConfigMap.set(wf.id, {
            steps: wf.steps || [],
            triggers: (wf as any).triggers || [],
            team: wf.team,
            description: wf.description,
            _slackConnections: slackConnections.length > 0 ? slackConnections : undefined,
          })
        }
        for (const eo of eventOrchestrations) {
          richConfigMap.set(eo.id, {
            team: eo.team,
            integrations: eo.integrations,
            _routerRules: (eo as any)._routerRules,
            _routedServiceIds: (eo as any)._routedServiceIds,
          })
        }

        // Create PdResource records in batches for performance
        const CHUNK_SIZE = 500
        const resourceEntries = Object.values(resources)
        for (let i = 0; i < resourceEntries.length; i += CHUNK_SIZE) {
          await prisma.pdResource.createMany({
            data: resourceEntries.slice(i, i + CHUNK_SIZE).map((resource) => ({
              snapshotId: configSnapshot.id,
              pdType: resource.type as any,
              pdId: resource.pdId,
              name: resource.name,
              teamIds: resource.teamIds,
              configJson: Buffer.from(JSON.stringify({
                id: resource.pdId,
                type: resource.type,
                name: resource.name,
                teamIds: resource.teamIds,
                dependencies: resource.dependencies,
                ...(richConfigMap.get(resource.pdId) || {}),
              }), 'utf8'),
              isStale: resource.isStale,
              dependencies: resource.dependencies,
            })),
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
