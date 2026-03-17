import type {
  PDService,
  PDTeam,
  PDSchedule,
  PDEscalationPolicy,
  PDUser,
  PDBusinessService,
  PDIncident,
  PDIntegration,
  PDLogEntry,
  PDAnalyticsIncident,
  PDRuleset,
  PDEventOrchestration,
  PDExtension,
  PDWebhookSubscription,
  PDIncidentWorkflow,
  PDPaginatedResponse,
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
  private readonly requestsPerMinuteLimit = 900;
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
      const response = await this.request<{ abilities: string[] }>(
        "GET",
        "/abilities"
      );
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
   * List all services with optional team filter
   */
  async listServices(params?: { teamIds?: string[] }): Promise<PDService[]> {
    const requestParams: Record<string, any> = {
      include: ["integrations"],
    };

    if (params?.teamIds && params.teamIds.length > 0) {
      requestParams.team_ids = params.teamIds;
    }

    return this.paginateAll<PDService>("/services", "services", requestParams);
  }

  /**
   * List all teams
   */
  async listTeams(): Promise<PDTeam[]> {
    return this.paginateAll<PDTeam>("/teams", "teams");
  }

  /**
   * List all schedules
   */
  async listSchedules(): Promise<PDSchedule[]> {
    return this.paginateAll<PDSchedule>("/schedules", "schedules");
  }

  /**
   * List all escalation policies
   */
  async listEscalationPolicies(): Promise<PDEscalationPolicy[]> {
    return this.paginateAll<PDEscalationPolicy>(
      "/escalation_policies",
      "escalation_policies"
    );
  }

  /**
   * List all users
   */
  async listUsers(): Promise<PDUser[]> {
    return this.paginateAll<PDUser>("/users", "users");
  }

  /**
   * List all business services
   */
  async listBusinessServices(): Promise<PDBusinessService[]> {
    return this.paginateAll<PDBusinessService>(
      "/business_services",
      "business_services"
    );
  }

  /**
   * List incidents with optional filters
   */
  async listIncidents(params: {
    teamIds?: string[];
    serviceIds?: string[];
    since: string;
    until: string;
    onPage?: (fetched: number, hasMore: boolean) => void;
  }): Promise<PDIncident[]> {
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
      params.onPage
    );
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
   * Get incident workflows
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
    return this.paginateAll<PDEventOrchestration>(
      "/event_orchestrations",
      "orchestrations"
    );
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
   * Check and enforce rate limiting (900 requests per minute)
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
}
