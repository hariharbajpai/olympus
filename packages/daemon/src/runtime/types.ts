import type { ActivationOutcome, Employee, EmployeeId, Level, RuntimeMode } from '@olympus/shared';

export interface InboxItem {
  from: EmployeeId | 'owner' | 'system';
  fromLabel: string;
  text: string;
  ts: string;
}

export interface ToolResult {
  ok: boolean;
  text: string;
}

export interface HireProposalInput {
  role: string;
  name: string;
  level: Level;
  reason: string;
}

/** Company actions an employee can take. Each call is checked by the company, not trusted. */
export interface CompanyTools {
  postMessage(to: string, text: string): ToolResult;
  reportStatus(summary: string): ToolResult;
  listTeam(): ToolResult;
  proposeTeam(hires: HireProposalInput[]): ToolResult;
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
  /** Everything the employee needs for this activation: who they are, the team, new messages. */
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
      return 'checked the team list';
    case 'propose_team': {
      const hires = Array.isArray(args.hires) ? args.hires.length : 0;
      return `proposed a team of ${hires}`;
    }
    default:
      return `${tool}(${clip(JSON.stringify(args), 60)})`;
  }
}
