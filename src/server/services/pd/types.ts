/**
 * PagerDuty API Response Types
 * Interfaces for all PD objects used in the migration analyzer
 */

export interface PDUser {
  id: string;
  type: "user_reference" | "user";
  summary?: string;
  self: string;
  html_url?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  color?: string;
  user_url?: string;
  invitation_sent?: boolean;
  confirmation_sent?: boolean;
}

export interface PDTeam {
  id: string;
  type: "team_reference" | "team";
  summary?: string;
  self: string;
  html_url?: string;
  name?: string;
  description?: string;
  default_role?: string;
  members?: PDUser[];
}

export interface PDSchedule {
  id: string;
  type: "schedule_reference" | "schedule";
  summary?: string;
  self: string;
  html_url?: string;
  name?: string;
  description?: string;
  time_zone?: string;
  escalation_policies?: PDEscalationPolicy[];
  teams?: PDTeam[];
  users?: PDUser[];
  final_schedule?: Record<string, any>;
  overflow_user_ids?: string[];
}

export interface PDEscalationPolicy {
  id: string;
  type: "escalation_policy_reference" | "escalation_policy";
  summary?: string;
  self: string;
  html_url?: string;
  name?: string;
  description?: string;
  num_loops?: number;
  escalation_rules?: Array<{
    id: string;
    escalation_delay_in_minutes: number;
    targets: Array<{
      id: string;
      type: "user_reference" | "schedule_reference";
    }>;
  }>;
  teams?: PDTeam[];
  services?: PDService[];
}

export interface PDIntegration {
  id: string;
  type: "integration_reference" | "integration";
  summary?: string;
  self: string;
  html_url?: string;
  name?: string;
  service?: PDService;
  created_at?: string;
  vendor?: {
    id: string;
    type: "vendor_reference";
    summary?: string;
    self?: string;
    html_url?: string;
    name?: string;
    logo_url?: string;
    logo_sm_url?: string;
    vendor_url?: string;
    generic_events_enabled?: boolean;
    guides?: string[];
    alert_creation_default?: string;
    alert_creation_on_resolve?: string;
  };
}

export interface PDService {
  id: string;
  type: "service_reference" | "service";
  summary?: string;
  self: string;
  html_url?: string;
  name?: string;
  description?: string;
  auto_resolve_timeout?: number | null;
  acknowledgement_timeout?: number | null;
  status?: string;
  created_at?: string;
  escalation_policy?: PDEscalationPolicy;
  teams?: PDTeam[];
  integrations?: PDIntegration[];
  incident_urgency_type?: string;
  incident_urgency_custom_num_seconds?: number | null;
  support_hours?: {
    type: "fixed_time_per_day";
    timezone: string;
    days_of_week: number[];
    start_time: string;
    end_time: string;
  } | null;
  status_update_type?: string;
}

export interface PDBusinessService {
  id: string;
  type: "business_service_reference" | "business_service";
  summary?: string;
  self: string;
  html_url?: string;
  name?: string;
  description?: string;
  created_at?: string;
  account?: {
    type: "account_reference";
    id: string;
  };
}

export interface PDIncident {
  incident_number?: number;
  title?: string;
  description?: string;
  created_at?: string;
  status?: string;
  pending_actions?: Array<{ type: string }>;
  incident_key?: string;
  service?: PDService;
  assignments?: Array<{
    at: string;
    assignee: PDUser;
  }>;
  last_status_change_at?: string;
  last_status_change_by?: {
    type: string;
    summary: string;
    self: string;
  };
  first_trigger_log_entry?: {
    type: string;
    summary: string;
    self: string;
  };
  escalation_policy?: PDEscalationPolicy;
  teams?: PDTeam[];
  urgency?: string;
  id: string;
  type: "incident_reference" | "incident";
  summary?: string;
  self: string;
  html_url?: string;
}

export interface PDLogEntry {
  id: string;
  type: string;
  summary?: string;
  self: string;
  html_url?: string;
  created_at?: string;
  agent?: {
    id: string;
    type: string;
    summary?: string;
    self?: string;
  };
  user?: PDUser;
  incident?: PDIncident;
  service?: PDService;
  teams?: PDTeam[];
  channels?: Array<{ type: string; summary?: string }>;
  context?: Record<string, any>;
}

export interface PDAnalyticsIncident {
  id: string;
  incident_number: number;
  title: string;
  description?: string;
  created_at: string;
  status: string;
  pending_actions: Array<{ type: string }>;
  incident_key?: string;
  service: {
    id: string;
    type: string;
    summary: string;
    self: string;
    html_url?: string;
  };
  assignments: Array<{
    at: string;
    assignee: {
      id: string;
      type: string;
      summary: string;
      self: string;
    };
  }>;
  last_status_change_at?: string;
  last_status_change_by?: {
    id: string;
    type: string;
    summary: string;
    self: string;
  };
  first_trigger_log_entry?: {
    id: string;
    type: string;
    summary: string;
    self: string;
  };
  escalation_policy: {
    id: string;
    type: string;
    summary: string;
    self: string;
    html_url?: string;
  };
  teams: PDTeam[];
  urgency: string;
  html_url?: string;
}

export interface PDRuleset {
  id: string;
  type: "ruleset_reference" | "ruleset";
  summary?: string;
  self: string;
  html_url?: string;
  name?: string;
  description?: string;
  created_at?: string;
  routing_keys?: string[];
  evaluation_order?: number;
  teams?: PDTeam[];
}

export interface PDEventOrchestration {
  id: string;
  name: string;
  description?: string;
  self?: string;
  team?: { id: string; type: string; summary?: string } | null;
  integrations?: Array<{
    id: string;
    type?: string;
    parameters?: { routing_key?: string; type?: string };
  }>;
  routes?: number;
  created_at?: string;
  created_by?: { id: string; type: string; self?: string };
  updated_at?: string;
  updated_by?: { id: string; type: string; self?: string };
  version?: string;
}

export interface PDPaginatedResponse<T> {
  limit: number;
  offset: number;
  total: number;
  more: boolean;
  incremental_index: number;
}
