import type {
  PDService,
  PDTeam,
  PDTeamMember,
  PDSchedule,
  PDEscalationPolicy,
  PDUser,
  PDBusinessService,
  PDServiceDependency,
  PDIncident,
  PDIntegration,
  PDLogEntry,
  PDAnalyticsIncident,
  PDAnalyticsServiceMetric,
  PDRuleset,
  PDEventOrchestration,
  PDExtension,
  PDWebhookSubscription,
  PDIncidentWorkflow,
  PDAlert,
  PDSlackConnection,
  PDPaginatedResponse,
  PDAutomationAction,
  PDAutomationRunner,
  PDAutomationInvocation,
  PDChangeEvent,
} from "./types";

interface RateLimitState {
  requestsThisMinute: number;
  lastResetTime: number;
}

/**
 * PagerDuty API Client
 * Wraps the PD REST API with rate limiting, pagination, and retry logic
 */
export class PagerDutyClient {
  private readonly token: string;
  private readonly subdomain: string;
  private readonly baseUrl = "https://api.pagerduty.com";
  private readonly rateLimitState: RateLimitState = {
    requestsThisMinute: 0,
    lastResetTime: Date.now(),
  };
  private readonly requestsPerMinuteLimit = 500;
  private readonly retryDelay = 1000; // start at 1s

  constructor(opts: { token: string; subdomain: string }) {
    this.token = opts.token;
    this.subdomain = opts.subdomain;
  }

  /**
   * Validate the API token by calling GET /abilities
   */
  async validateToken(): Promise<{
    valid: boolean;
    accountName?: string;
    error?: string;
  }> {
    try {
      await this.request<{ abilities: string[] }>("GET", "/abilities");
      return {
        valid: true,
        accountName: this.subdomain,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch the account's enabled abilities (feature/plan flags).
   * Returns empty array if the endpoint is unavailable or the token lacks access.
   * Key abilities: event_intelligence, aiops, automation_actions, incident_workflows,
   * preview_intelligent_alert_grouping, preview_machine_learning_early_access
   */
  async getAccountAbilities(): Promise<string[]> {
    try {
      const response = await this.request<{ abilities: string[] }>(
        "GET",
        "/abilities"
      );
      return response.abilities || [];
    } catch {
      return [];
    }
  }

  /**
   * List all services with optional team filter
   */
  async listServices(params?: { teamIds?: string[] }): Promise<PDService[]> {
    const baseParams: Record<string, any> = {};
    if (params?.teamIds && params.teamIds.length > 0) {
      baseParams.team_ids = params.teamIds;
    }

    try {
      // alert_grouping_parameters requires Event Intelligence / AIOps — may 500 on basic plans
      return await this.paginateAll<PDService>("/services", "services", {
        ...baseParams,
        include: ["integrations", "alert_grouping_parameters"],
      });
    } catch {
      return this.paginateAll<PDService>("/services", "services", {
        ...baseParams,
        include: ["integrations"],
      });
    }
  }

  /**
   * List all teams
   */
  async listTeams(): Promise<PDTeam[]> {
    return this.paginateAll<PDTeam>("/teams", "teams");
  }

  /**
   * Get members (with roles) for a single team.
   * The list teams endpoint does not include members.
   */
  async getTeamMembers(teamId: string): Promise<PDTeamMember[]> {
    try {
      return await this.paginateAll<PDTeamMember>(
        `/teams/${teamId}/members`,
        "members"
      );
    } catch {
      return [];
    }
  }

  /**
   * Enrich a list of teams with their members, batched to avoid rate limits.
   * Fetches up to maxConcurrent teams at a time.
   */
  async enrichTeamsWithMembers(
    teams: PDTeam[],
    maxConcurrent = 10
  ): Promise<PDTeam[]> {
    const enriched: PDTeam[] = [];
    for (let i = 0; i < teams.length; i += maxConcurrent) {
      const chunk = teams.slice(i, i + maxConcurrent);
      const results = await Promise.allSettled(
        chunk.map((t) => this.getTeamMembers(t.id))
      );
      for (let j = 0; j < chunk.length; j++) {
        const r = results[j];
        enriched.push({
          ...chunk[j],
          members: r.status === "fulfilled" ? r.value : [],
        });
      }
    }
    return enriched;
  }

  /**
   * List all schedules
   */
  async listSchedules(): Promise<PDSchedule[]> {
    // schedule_layers and users are NOT returned by default on the list endpoint — must be
    // explicitly requested. teams gives ownership info.
    return this.paginateAll<PDSchedule>("/schedules", "schedules", {
      include: ['schedule_layers', 'users', 'teams'],
    });
  }

  /**
   * List all escalation policies
   */
  async listEscalationPolicies(): Promise<PDEscalationPolicy[]> {
    try {
      return await this.paginateAll<PDEscalationPolicy>(
        "/escalation_policies",
        "escalation_policies"
      );
    } catch {
      return [];
    }
  }

  /**
   * List all users
   */
  async listUsers(): Promise<PDUser[]> {
    // NOTE: user notification rules and contact methods are not fetched here —
    // per-user API calls are prohibitive at scale (1000s of users).
    try {
      return await this.paginateAll<PDUser>("/users", "users");
    } catch {
      return [];
    }
  }

  /**
   * List all business services
   */
  async listBusinessServices(): Promise<PDBusinessService[]> {
    try {
      return await this.paginateAll<PDBusinessService>(
        "/business_services",
        "business_services"
      );
    } catch {
      // Business services may not be available on all plan tiers
      return [];
    }
  }

  /**
   * List all technical service-to-service dependency relationships.
   * Returns the full graph in a single paginated call.
   */
  async listServiceDependencies(): Promise<PDServiceDependency[]> {
    try {
      return await this.paginateAll<PDServiceDependency>(
        "/service_dependencies/technical_services",
        "relationships"
      );
    } catch {
      return [];
    }
  }

  /**
   * Get the technical services that support a given business service.
   */
  async getBusinessServiceDependencies(
    businessServiceId: string
  ): Promise<PDServiceDependency[]> {
    try {
      const response = await this.request<{
        relationships: PDServiceDependency[];
      }>("GET", `/business_services/${businessServiceId}/service_dependencies`);
      return response.relationships || [];
    } catch {
      return [];
    }
  }

  /**
   * List incidents with optional filters.
   *
   * maxIncidentsPerService: when set, each per-service-chunk is capped at
   *   chunkSize * maxIncidentsPerService entries. This prevents noisy services
   *   from bloating the fetch far beyond what the caller will ultimately use.
   *   Falls back to chunkSize * 60 when not specified (backwards-compatible).
   */
  async listIncidents(params: {
    teamIds?: string[];
    serviceIds?: string[];
    since: string;
    until: string;
    maxIncidents?: number;
    maxIncidentsPerService?: number;
    onPage?: (fetched: number, hasMore: boolean) => void;
  }): Promise<PDIncident[]> {
    // When there are many service IDs the query string exceeds URL length limits (HTTP 414).
    // Chunk service IDs into groups of 50 and merge results.
    const MAX_SERVICE_IDS_PER_REQUEST = 50;
    if (params.serviceIds && params.serviceIds.length > MAX_SERVICE_IDS_PER_REQUEST) {
      const allIncidents: PDIncident[] = [];
      const chunks: string[][] = [];
      for (let i = 0; i < params.serviceIds.length; i += MAX_SERVICE_IDS_PER_REQUEST) {
        chunks.push(params.serviceIds.slice(i, i + MAX_SERVICE_IDS_PER_REQUEST));
      }

      let chunkIdx = 0;
      for (const chunk of chunks) {
        chunkIdx++;
        console.log(
          `[PD Client] Fetching incidents for service chunk ${chunkIdx}/${chunks.length} (${chunk.length} services)`
        );
        // Budget per chunk: prefer an explicit per-service cap, then a total cap,
        // then fall back to a 60-incident-per-service safety buffer.
        const perServiceBudget = params.maxIncidentsPerService ?? 60;
        const chunkMaxEntries = params.maxIncidents ?? chunk.length * perServiceBudget;
        const chunkResults = await this.listIncidents({
          ...params,
          serviceIds: chunk,
          maxIncidents: chunkMaxEntries,
          onPage: params.onPage
            ? (fetched, hasMore) => {
                params.onPage!(allIncidents.length + fetched, hasMore);
              }
            : undefined,
        });
        allIncidents.push(...chunkResults);
      }
      return allIncidents;
    }

    // PD API limits the date range to ~6 months for /incidents.
    // For longer ranges, break into 180-day chunks and merge results.
    const sinceDate = new Date(params.since);
    const untilDate = new Date(params.until);
    const diffDays = Math.ceil(
      (untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const MAX_CHUNK_DAYS = 179; // stay under the 6-month limit
    if (diffDays <= MAX_CHUNK_DAYS) {
      return this._listIncidentsSingle(params);
    }

    // Break into chunks
    const allIncidents: PDIncident[] = [];
    let chunkStart = new Date(sinceDate);

    while (chunkStart < untilDate) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() + MAX_CHUNK_DAYS);
      if (chunkEnd > untilDate) {
        chunkEnd.setTime(untilDate.getTime());
      }

      console.log(
        `[PD Client] Fetching incidents chunk: ${chunkStart.toISOString().slice(0, 10)} → ${chunkEnd.toISOString().slice(0, 10)}`
      );

      const chunkIncidents = await this._listIncidentsSingle({
        ...params,
        since: chunkStart.toISOString(),
        until: chunkEnd.toISOString(),
        maxIncidents: params.maxIncidents,
        onPage: params.onPage
          ? (fetched, hasMore) => {
              params.onPage!(allIncidents.length + fetched, hasMore);
            }
          : undefined,
      });

      allIncidents.push(...chunkIncidents);
      chunkStart = new Date(chunkEnd);
    }

    return allIncidents;
  }

  private async _listIncidentsSingle(params: {
    teamIds?: string[];
    serviceIds?: string[];
    since: string;
    until: string;
    maxIncidents?: number;
    maxIncidentsPerService?: number;
    onPage?: (fetched: number, hasMore: boolean) => void;
  }): Promise<PDIncident[]> {
    const requestParams: Record<string, any> = {
      since: params.since,
      until: params.until,
      // Expand first_trigger_log_entry to get channel details including source
      include: ['first_trigger_log_entry'],
    };

    if (params.teamIds && params.teamIds.length > 0) {
      requestParams.team_ids = params.teamIds;
    }

    if (params.serviceIds && params.serviceIds.length > 0) {
      requestParams.service_ids = params.serviceIds;
    }

    return this.paginateAll<PDIncident>(
      "/incidents",
      "incidents",
      requestParams,
      params.onPage,
      params.maxIncidents
    );
  }

  /**
   * List change events (deployment events) for the given time range.
   * Returns empty array if the endpoint is unavailable (plan tier limitation).
   */
  async listChangeEvents(params: {
    since: string;
    until: string;
    serviceIds?: string[];
    limit?: number;
  }): Promise<PDChangeEvent[]> {
    try {
      const requestParams: Record<string, any> = {
        since: params.since,
        until: params.until,
      };
      if (params.serviceIds && params.serviceIds.length > 0) {
        requestParams.service_ids = params.serviceIds;
      }
      return await this.paginateAll<PDChangeEvent>(
        "/change_events",
        "change_events",
        requestParams,
        undefined,
        params.limit ?? 1000
      );
    } catch {
      return [];
    }
  }

  /**
   * Get aggregate incident metrics per service for the given time range.
   * Uses POST /analytics/metrics/incidents/services — handles all service IDs
   * in the request body so there is no URL length limit.
   * Returns empty array if the endpoint is unavailable (plan tier limitation).
   */
  async getAnalyticsMetricsByService(params: {
    serviceIds: string[];
    since: string;
    until: string;
  }): Promise<PDAnalyticsServiceMetric[]> {
    try {
      const body = {
        filters: {
          created_at_start: params.since,
          created_at_end: params.until,
          ...(params.serviceIds.length > 0 ? { service_ids: params.serviceIds } : {}),
        },
        time_zone: 'UTC',
      };
      const response = await this.request<{ data: PDAnalyticsServiceMetric[] }>(
        'POST',
        '/analytics/metrics/incidents/services',
        {},
        body
      );
      return response.data || [];
    } catch {
      // Not available on this plan tier — gracefully return empty
      return [];
    }
  }

  /**
   * Get integrations for a specific service
   */
  async getServiceIntegrations(serviceId: string): Promise<PDIntegration[]> {
    return this.paginateAll<PDIntegration>(
      `/services/${serviceId}/integrations`,
      "integrations"
    );
  }

  /**
   * Get account-level extensions (ServiceNow, Slack, MS Teams, JIRA, etc.)
   */
  async listExtensions(): Promise<PDExtension[]> {
    return this.paginateAll<PDExtension>("/extensions", "extensions");
  }

  /**
   * Get webhook subscriptions (outbound webhooks v3)
   */
  async listWebhookSubscriptions(): Promise<PDWebhookSubscription[]> {
    try {
      return await this.paginateAll<PDWebhookSubscription>(
        "/webhook_subscriptions",
        "webhook_subscriptions"
      );
    } catch {
      // Some accounts may not have access to this endpoint
      return [];
    }
  }

  /**
   * Get incident workflows (list only — no steps/triggers)
   */
  async listIncidentWorkflows(): Promise<PDIncidentWorkflow[]> {
    try {
      return await this.paginateAll<PDIncidentWorkflow>(
        "/incident_workflows",
        "incident_workflows"
      );
    } catch {
      // Incident workflows may not be available on all plan tiers
      return [];
    }
  }

  /**
   * Get full detail for a single incident workflow (includes steps with action_ids and triggers)
   * The list endpoint does NOT return steps/triggers — must fetch individually.
   */
  async getIncidentWorkflowDetail(workflowId: string): Promise<PDIncidentWorkflow | null> {
    try {
      const response = await this.request<{ incident_workflow: PDIncidentWorkflow }>(
        "GET",
        `/incident_workflows/${workflowId}`,
        { include: ["steps", "triggers"] }
      );
      const wf = response.incident_workflow || null;
      if (wf) {
        console.log(`[PD Client] Workflow ${workflowId} detail: ${wf.steps?.length ?? 0} steps, ${wf.triggers?.length ?? 0} triggers`);
      } else {
        console.warn(`[PD Client] Workflow ${workflowId} detail: response had no incident_workflow key`);
      }
      return wf;
    } catch (error) {
      console.warn(`[PD Client] Failed to fetch workflow detail for ${workflowId}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Get alerts for a specific incident (for source identification via alert payload)
   */
  async listIncidentAlerts(incidentId: string, params?: { limit?: number }): Promise<PDAlert[]> {
    try {
      const requestParams: Record<string, any> = {
        limit: params?.limit || 5,
      };
      const response = await this.request<{ alerts: PDAlert[] }>(
        "GET",
        `/incidents/${incidentId}/alerts`,
        requestParams
      );
      return response.alerts || [];
    } catch {
      return [];
    }
  }

  /**
   * Get account-level Slack connections.
   * Returns 404 if Slack is integrated only via Incident Workflows.
   */
  async getSlackConnections(): Promise<PDSlackConnection[]> {
    try {
      const response = await this.request<{ slack_connections: PDSlackConnection[] }>(
        "GET",
        "/slack_connections"
      );
      return response.slack_connections || [];
    } catch {
      // 404 is expected if Slack integration uses workflows only
      return [];
    }
  }

  /**
   * Get log entries with optional filters
   */
  async getLogEntries(params: {
    since: string;
    until: string;
    isOverview?: boolean;
    maxEntries?: number;
    onPage?: (fetched: number, hasMore: boolean) => void;
  }): Promise<PDLogEntry[]> {
    const requestParams: Record<string, any> = {
      since: params.since,
      until: params.until,
    };

    if (params.isOverview !== undefined) {
      requestParams.is_overview = params.isOverview;
    }

    return this.paginateAll<PDLogEntry>("/log_entries", "log_entries", requestParams, params.onPage, params.maxEntries);
  }

  /**
   * Get analytics incidents using the analytics API
   */
  async getAnalyticsIncidents(params: {
    serviceIds?: string[];
    since: string;
    until: string;
  }): Promise<PDAnalyticsIncident[]> {
    const body = {
      data: {
        filters: {
          created_at: {
            type: "account_reference",
          },
        },
      },
    };

    if (params.serviceIds && params.serviceIds.length > 0) {
      (body.data.filters as any).service_ids = params.serviceIds;
    }

    const response = await this.request<{
      data: PDAnalyticsIncident[];
      pagination: PDPaginatedResponse<PDAnalyticsIncident>;
    }>("POST", "/analytics/raw/incidents", {}, body);

    return response.data || [];
  }

  /**
   * Get legacy rulesets (deprecated, but some accounts still have them)
   */
  async getRulesets(): Promise<PDRuleset[]> {
    try {
      return await this.paginateAll<PDRuleset>("/rulesets", "rulesets");
    } catch {
      // Rulesets API may 404 on newer accounts
      return [];
    }
  }

  /**
   * List all Event Orchestrations (global)
   */
  async listEventOrchestrations(): Promise<PDEventOrchestration[]> {
    try {
      return await this.paginateAll<PDEventOrchestration>(
        "/event_orchestrations",
        "orchestrations"
      );
    } catch {
      // Event orchestrations may not be available on all plan tiers
      return [];
    }
  }

  /**
   * Get the router rules for a specific Event Orchestration.
   * This reveals which services are dynamically routed to.
   */
  async getOrchestrationRouter(orchestrationId: string): Promise<any> {
    const response = await this.request<any>(
      "GET",
      `/event_orchestrations/${orchestrationId}/router`
    );
    return response.orchestration_path || response;
  }

  // ── Automation Actions API (cursor-based pagination) ──

  /**
   * List all automation actions in the domain.
   * Uses cursor-based pagination (not offset/limit).
   */
  async listAutomationActions(): Promise<PDAutomationAction[]> {
    try {
      return await this.paginateAllCursor<PDAutomationAction>(
        "/automation_actions/actions",
        "actions"
      );
    } catch {
      // automation_actions may not be available on all plan tiers
      return [];
    }
  }

  /**
   * List all automation runners in the domain.
   */
  async listAutomationRunners(): Promise<PDAutomationRunner[]> {
    try {
      return await this.paginateAllCursor<PDAutomationRunner>(
        "/automation_actions/runners",
        "runners"
      );
    } catch {
      return [];
    }
  }

  /**
   * Get invocation history for a specific automation action.
   * Returns all invocations (cursor-paginated).
   */
  async getAutomationActionInvocations(
    actionId: string,
    maxEntries?: number
  ): Promise<PDAutomationInvocation[]> {
    try {
      return await this.paginateAllCursor<PDAutomationInvocation>(
        "/automation_actions/invocations",
        "invocations",
        { action_id: actionId },
        maxEntries
      );
    } catch {
      return [];
    }
  }

  /**
   * Make an HTTP request to the PD API with auth, rate limiting, and retries
   */
  private async request<T>(
    method: string,
    path: string,
    params?: Record<string, any>,
    body?: any
  ): Promise<T> {
    await this.checkRateLimit();

    const url = new URL(`${this.baseUrl}${path}`);

    // Add query parameters
    if (params && method === "GET") {
      Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key + "[]", String(v)));
        } else if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      Authorization: `Token token=${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.pagerduty+json;version=2",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      options.body = JSON.stringify(body);
    }

    return this.requestWithRetry<T>(url.toString(), options);
  }

  /**
   * Execute request with exponential backoff retry for 429 responses
   */
  private async requestWithRetry<T>(
    url: string,
    options: RequestInit,
    retryCount = 0,
    delay = this.retryDelay
  ): Promise<T> {
    const response = await fetch(url, options);

    if (response.status === 429) {
      if (retryCount >= 5) {
        throw new Error(
          `Rate limited after ${retryCount} retries. Max retry limit reached.`
        );
      }

      const newDelay = Math.min(delay * 2, 30000); // exponential backoff, max 30s
      await new Promise((resolve) => setTimeout(resolve, newDelay));
      return this.requestWithRetry<T>(url, options, retryCount + 1, newDelay);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `PD API Error ${response.status}: ${
          error.error?.message || response.statusText
        }`
      );
    }

    this.rateLimitState.requestsThisMinute++;

    return response.json();
  }

  /**
   * Check and enforce rate limiting (500 requests per minute — conservative limit below PD's 900/min cap)
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsedMs = now - this.rateLimitState.lastResetTime;

    // Reset counter if a minute has passed
    if (elapsedMs >= 60000) {
      this.rateLimitState.requestsThisMinute = 0;
      this.rateLimitState.lastResetTime = now;
      return;
    }

    // Check if approaching limit (use 85% of limit to be safe)
    const threshold = (this.requestsPerMinuteLimit * 85) / 100;
    if (this.rateLimitState.requestsThisMinute >= threshold) {
      const delayMs = Math.ceil(60000 - elapsedMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      this.rateLimitState.requestsThisMinute = 0;
      this.rateLimitState.lastResetTime = Date.now();
    }
  }

  /**
   * Auto-paginate through all results using offset and limit.
   * Accepts an optional onPage callback for progress reporting.
   * Optional maxEntries caps total results to prevent OOM on large accounts.
   */
  private async paginateAll<T>(
    path: string,
    resourceKey: string,
    params?: Record<string, any>,
    onPage?: (fetched: number, hasMore: boolean) => void,
    maxEntries?: number
  ): Promise<T[]> {
    const allResults: T[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const paginatedParams = {
        ...params,
        limit,
        offset,
      };

      const response = await this.request<{
        [key: string]: T[] | any;
      }>("GET", path, paginatedParams);

      const items = (response as any)[resourceKey] || [];
      allResults.push(...items);

      hasMore = (response as any).more === true;
      offset += limit;

      // Cap total entries to prevent OOM on large accounts
      if (maxEntries && allResults.length >= maxEntries) {
        hasMore = false;
      }

      if (onPage) {
        onPage(allResults.length, hasMore);
      }
    }

    return allResults;
  }

  /**
   * Auto-paginate through all results using cursor-based pagination.
   * Used by automation actions endpoints which use `next_cursor` instead of offset/limit.
   */
  private async paginateAllCursor<T>(
    path: string,
    resourceKey: string,
    params?: Record<string, any>,
    maxEntries?: number
  ): Promise<T[]> {
    const allResults: T[] = [];
    let cursor: string | undefined;

    while (true) {
      const paginatedParams: Record<string, any> = {
        ...params,
        limit: 25,
      };
      if (cursor) {
        paginatedParams.cursor = cursor;
      }

      const response = await this.request<{
        [key: string]: T[] | any;
      }>("GET", path, paginatedParams);

      const items = (response as any)[resourceKey] || [];
      allResults.push(...items);

      cursor = (response as any).next_cursor;

      // Cap total entries
      if (maxEntries && allResults.length >= maxEntries) {
        break;
      }

      if (!cursor) {
        break;
      }
    }

    return allResults;
  }
}
