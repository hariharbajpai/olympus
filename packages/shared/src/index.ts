// Types shared by the daemon, dashboard, CLI and plugin MCP server.
// This package is type-only: import it with `import type`.

export type EmployeeId = string;

export type EmployeeStatus = 'idle' | 'queued' | 'working' | 'fired';

/**
 * - `claude-code`: employees run as Claude Code subagents inside the Owner's Claude Code
 *   session (the app's own login). The session picks work up with /olympus:brief or /olympus:run.
 * - `simulated`: a free, scripted stand-in run by the daemon, for demos and tests.
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
  level: Level | null;
  /** Who this person reports to, worked out from the org structure. null means the Owner. */
  managerId: EmployeeId | null;
  model: string;
  effort: Effort;
  status: EmployeeStatus;
  /** One-line description of what the employee is doing right now. */
  activity: string;
  activations: number;
  lastDurationMs: number | null;
  hiredAt: string;
  hiredBy: EmployeeId | 'owner' | 'founding';
  firedAt?: string;
  firedReason?: string;
}

/** A hire HR has proposed. HR can hire them only after the Owner approves the PRD. */
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

export type ProjectPhase = 'planning' | 'prd_review' | 'approved' | 'building' | 'done';

export interface PrdVersion {
  version: number;
  title: string;
  markdown: string;
  submittedBy: EmployeeId;
  submittedAt: string;
  status: 'pending' | 'approved' | 'changes_requested' | 'superseded';
  ownerComment: string | null;
  decidedAt: string | null;
}

export interface Project {
  id: string;
  title: string;
  brief: string;
  phase: ProjectPhase;
  /** Folder where engineers write the product's code. */
  workspaceDir: string;
  startedAt: string;
  prd: PrdVersion[];
}

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'blocked' | 'done';

export interface TaskNote {
  ts: string;
  by: EmployeeId | 'owner' | 'system';
  text: string;
  status?: TaskStatus;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: EmployeeId | null;
  status: TaskStatus;
  createdBy: EmployeeId;
  createdAt: string;
  updatedAt: string;
  notes: TaskNote[];
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

export interface HostState {
  /** Activations waiting for the Claude Code session to pick them up. */
  waiting: number;
  /** Activations a Claude Code session is running right now. */
  running: number;
  lastSeenAt: string | null;
}

export interface Settings {
  mode: RuntimeMode;
  maxConcurrency: number;
  maxActivationsPerEmployee: number;
  maxActivationsPerProject: number;
}

/** Timestamps the dashboard turns into charts. */
export interface Metrics {
  activations: string[];
  tasksDone: string[];
  messages: string[];
}

export interface CompanyState {
  companyName: string;
  settings: Settings;
  activationsThisProject: number;
  roles: OrgRole[];
  /** Everyone, including people who were fired (status "fired"). */
  employees: Employee[];
  proposals: ProposedHire[];
  project: Project | null;
  tasks: Task[];
  messages: ChatMessage[];
  host: HostState;
  metrics: Metrics;
  /** True while any employee has unread messages or is working. */
  busy: boolean;
  /** What the company is waiting on, if anything. */
  waitingFor: 'owner_prd' | 'claude_code' | null;
}

export type ActivationOutcome = 'success' | 'error' | 'aborted';

export type CompanyEventPayload =
  | { type: 'company.reset' }
  | { type: 'settings.updated'; settings: Settings }
  | { type: 'project.started'; projectId: string; title: string }
  | { type: 'project.phase_changed'; phase: ProjectPhase }
  | { type: 'prd.submitted'; version: number; title: string; by: EmployeeId }
  | { type: 'prd.decided'; version: number; decision: 'approved' | 'changes_requested'; comment: string | null }
  | { type: 'employee.hired'; employeeId: EmployeeId; by: EmployeeId | 'owner' | 'founding' }
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
  | { type: 'task.created'; taskId: string; title: string; assigneeId: EmployeeId | null; by: EmployeeId }
  | { type: 'task.updated'; taskId: string; status: TaskStatus; by: EmployeeId | 'system'; note: string | null }
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
  | { kind: 'events'; events: CompanyEvent[]; state: CompanyState };

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
  | { status: 'finished'; message: string; waitingFor: 'owner_prd' | null; ownerMessages: string[] }
  | { status: 'no_run'; message: string };

export interface AgentToolResponse {
  ok: boolean;
  text: string;
}

/** Tools employees can call, by name. The daemon checks who may call which. */
export type EmployeeToolName =
  | 'post_message'
  | 'report_status'
  | 'list_team'
  | 'get_project'
  | 'list_tasks'
  | 'create_task'
  | 'update_task'
  | 'submit_prd'
  | 'propose_team'
  | 'hire_team';
