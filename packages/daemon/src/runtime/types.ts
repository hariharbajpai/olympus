import type { ActivationOutcome, Employee, EmployeeId, RuntimeMode } from '@olympus/shared';

export type InboxKind =
  | 'brief'
  | 'owner'
  | 'prd_approved'
  | 'prd_changes'
  | 'task'
  | 'task_update'
  | 'onboarding'
  | 'dm'
  | 'system';

export interface InboxItem {
  from: EmployeeId | 'owner' | 'system';
  fromLabel: string;
  kind: InboxKind;
  text: string;
  ts: string;
  /** The employee whose action caused this message (for system notices about tasks). */
  causedBy?: EmployeeId;
}

export interface ToolResult {
  ok: boolean;
  text: string;
}

/** Company actions an employee can take. Every call is checked by the company, not trusted. */
export interface CompanyTools {
  call(tool: string, input: Record<string, unknown>): ToolResult;
}

export type AgentStreamEvent =
  | { kind: 'note'; text: string }
  | { kind: 'action'; tool: string; summary: string };

export interface ActivationRequest {
  activationId: string;
  employee: Employee;
  /** Plugin subagent type that runs this employee, for example "olympus:ceo". */
  agentType: string;
  /** Short label for the Claude Code Agent call, for example "Aarav (CEO): 1 new message". */
  description: string;
  /** Everything the employee needs for this activation: who they are, the team, the project, new messages. */
  prompt: string;
  inbox: InboxItem[];
  abortController: AbortController;
  tools: CompanyTools;
  emit: (event: AgentStreamEvent) => void;
}

export interface ActivationResult {
  outcome: ActivationOutcome;
  durationMs: number;
  detail?: string;
  /** Put the inbox back so a later activation handles it (for example, after a host timeout). */
  requeue?: boolean;
}

export interface AgentRuntime {
  readonly mode: RuntimeMode;
  run(request: ActivationRequest): Promise<ActivationResult>;
}

/** One-line summary of a company tool call, for the activity feed. */
export function summarizeToolCall(tool: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const clip = (value: unknown, max = 90) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  switch (tool) {
    case 'post_message':
      return `→ ${clip(args.to, 30)}: ${clip(args.text)}`;
    case 'report_status':
      return `status: ${clip(args.summary)}`;
    case 'list_team':
      return 'checked the team';
    case 'get_project':
      return 'read the project and PRD';
    case 'list_tasks':
      return 'checked the task board';
    case 'create_task':
      return `created a task for ${clip(args.assignee, 30)}: ${clip(args.title, 70)}`;
    case 'update_task':
      return `${clip(args.task_id, 12)} → ${clip(args.status, 14)}${args.note ? `: ${clip(args.note, 70)}` : ''}`;
    case 'submit_prd':
      return `submitted the PRD “${clip(args.title, 60)}”`;
    case 'propose_team': {
      const hires = Array.isArray(args.hires) ? args.hires.length : 0;
      return `proposed a team of ${hires}`;
    }
    case 'hire_team':
      return 'hired the proposed team';
    default:
      return `${tool}(${clip(JSON.stringify(args), 60)})`;
  }
}
