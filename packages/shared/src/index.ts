// Types shared by the daemon, dashboard, CLI and plugin MCP server.
// This package is type-only: import it with `import type`.

export type EmployeeId = string;

export type EmployeeStatus = 'idle' | 'queued' | 'working' | 'fired';

/**
 * - `claude-code`: employees run as Claude Code subagents inside the Owner's Claude Code
 *   session (the app's own login). The session picks work up with /olympus:brief or /olympus:run.
 * - `simulated`: a free, scripted stand-in run by the daemon, for testing.
 */
export type RuntimeMode = 'claude-code' | 'simulated';

export type Level = 'sde1' | 'sde2' | 'senior' | 'mts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** A role in the company's org structure. `reportsTo` is another role id, or null for the Owner. */
export interface OrgRole {
  id: string;
  title: string;
  department: string;
  reportsTo: string | null;
  summary: string;
  defaultModel: string;
}

export interface Employee {
  id: EmployeeId;
  name: string;
  roleId: string;
  title: string;
  /** Who this person reports to. null means the Owner. */
  managerId: EmployeeId | null;
  model: string;
  effort: Effort;
  status: EmployeeStatus;
  /** One-line description of what the employee is doing right now. */
  activity: string;
  activations: number;
  lastDurationMs: number | null;
  firedReason?: string;
}

/** A hire HR has proposed. Nobody is hired until the Owner approves the PRD (Phase 1). */
export interface ProposedHire {
  id: string;
  roleId: string;
  name: string;
  level: Level;
  model: string;
  reason: string;
  proposedBy: EmployeeId;
  ts: string;
}

/** Where a message goes: an employee id, a channel like "#general", or "owner". */
export type MessageTarget = string;

export interface ChatMessage {
  id: number;
  ts: string;
  from: EmployeeId | 'owner' | 'system';
  to: MessageTarget;
  text: string;
}

export interface DemoState {
  running: boolean;
  mode: RuntimeMode | null;
  brief: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface HostState {
  /** Activations waiting for the Claude Code session to pick them up. */
  waiting: number;
  /** Activations a Claude Code session is running right now. */
  running: number;
  lastSeenAt: string | null;
}

export interface CompanyState {
  companyName: string;
  limits: {
    maxConcurrency: number;
    maxActivationsPerEmployee: number;
    maxActivationsPerRun: number;
  };
  activationsThisRun: number;
  roles: OrgRole[];
  employees: Employee[];
  proposals: ProposedHire[];
  messages: ChatMessage[];
  demo: DemoState;
  host: HostState;
}

export type ActivationOutcome = 'success' | 'error' | 'aborted';

export type CompanyEventPayload =
  | { type: 'company.reset' }
  | { type: 'demo.started'; mode: RuntimeMode; brief: string }
  | { type: 'demo.finished'; activations: number }
  | { type: 'employee.status_changed'; employeeId: EmployeeId; status: EmployeeStatus; activity: string }
  | { type: 'employee.fired'; employeeId: EmployeeId; reason: string }
  | { type: 'activation.started'; employeeId: EmployeeId; activationId: string; trigger: string }
  | {
      type: 'activation.completed';
      employeeId: EmployeeId;
      activationId: string;
      outcome: ActivationOutcome;
      durationMs: number;
      detail?: string;
    }
  | { type: 'host.claimed'; activationIds: string[] }
  | { type: 'agent.note'; employeeId: EmployeeId; text: string }
  | { type: 'agent.action'; employeeId: EmployeeId; tool: string; summary: string }
  | { type: 'message.posted'; message: ChatMessage }
  | { type: 'team.proposed'; employeeId: EmployeeId; count: number }
  | { type: 'system.notice'; level: 'info' | 'warning' | 'error'; text: string };

export type CompanyEventType = CompanyEventPayload['type'];

export type CompanyEvent = CompanyEventPayload & {
  /** Monotonic id, starting at 1. */
  id: number;
  ts: string;
};

/** Messages the daemon sends over the WebSocket. */
export type ServerFrame =
  | { kind: 'hello'; state: CompanyState; recentEvents: CompanyEvent[] }
  | { kind: 'event'; event: CompanyEvent; state: CompanyState };

export interface HealthResponse {
  ok: true;
  name: 'olympus-daemon';
  version: string;
  pid: number;
  port: number;
  startedAt: string;
}

/** One unit of work for the Claude Code session: run this subagent with this prompt. */
export interface HostActivation {
  activation_id: string;
  agent: string;
  description: string;
  prompt: string;
}

export type HostClaimResponse =
  | { status: 'work'; activations: HostActivation[] }
  | { status: 'busy'; running: number; message: string }
  | { status: 'finished'; message: string; ownerMessages: string[] }
  | { status: 'no_run'; message: string };

export interface AgentToolResponse {
  ok: boolean;
  text: string;
}
