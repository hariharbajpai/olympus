#!/usr/bin/env node
// Olympus plugin MCP server (stdio). Claude Code starts it for every session that has the plugin.
// Three groups of tools:
//  - the work loop, used by the Owner's session: start_project, next_work, activation_done
//  - Owner actions, used by the Owner's session: company_status, owner_message, get_prd,
//    decide_prd, owner_hire, owner_fire
//  - company tools, used by employee subagents (they need their activation id)
// Every tool is a thin call to the Olympus daemon, which holds the state and checks every rule.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AgentToolResponse, CompanyState, HostClaimResponse } from '@olympus/shared';
import { DaemonError, daemonFetch, dashboardUrl, ensureDaemon } from '../../cli/src/daemon-control.js';

const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError: true } : {}),
});

async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return text(err instanceof DaemonError || err instanceof Error ? err.message : String(err), true);
  }
}

/** Owner actions start the daemon if it isn't running yet. */
async function ownerCall<T>(apiPath: string, body?: unknown): Promise<T> {
  const up = await ensureDaemon();
  if (!up.ok) throw new DaemonError(up.error);
  return daemonFetch<T>(apiPath, body);
}

const server = new McpServer(
  { name: 'olympus-company', version: '0.1.0' },
  {
    instructions:
      'Olympus runs an AI software company inside this Claude Code session. The Owner starts work with /olympus:brief; the session then runs the work loop (next_work → Agent calls → activation_done). The Owner decides on the PRD with decide_prd and can hire, fire and message the CEO. The employee tools (post_message, report_status, list_team, get_project, list_tasks, create_task, update_task, submit_prd, propose_team, hire_team) belong to Olympus employee subagents and need their activation id.',
  },
);

// ───────────── Work loop (the Owner's session) ─────────────

server.registerTool(
  'start_project',
  {
    title: 'Start an Olympus project',
    description: 'Start Olympus (if needed) and give the CEO a new product brief from the Owner. Starts a new project; the team stays. Returns the dashboard link. After this, run the work loop with next_work.',
    inputSchema: { brief: z.string().min(5).max(4000).describe('What the Owner wants built, in their words') },
  },
  ({ brief }) =>
    guarded(async () => {
      const res = await ownerCall<{ project: { title: string; workspaceDir: string } }>('/api/project/start', { brief });
      return text(
        `Project “${res.project.title}” started. The CEO has the brief.\nCode will be written in: ${res.project.workspaceDir}\nDashboard (share the full link with the Owner): ${dashboardUrl()}\nNext: call next_work.`,
      );
    }),
);

server.registerTool(
  'next_work',
  {
    title: 'Get Olympus work to run',
    description: 'Get the employee activations that are ready to run. For each one, start an Agent call with subagent_type = agent, description = description and prompt = prompt (copied exactly), all in one message so they run in parallel. When each agent returns, call activation_done. Repeat until the status is "finished" or "no_run".',
    inputSchema: {},
  },
  () =>
    guarded(async () => {
      const claim = await daemonFetch<HostClaimResponse>('/api/host/claim', {});
      if (claim.status === 'work') {
        return text(
          JSON.stringify(
            {
              status: 'work',
              instructions:
                'Start one Agent call per activation below in this same message (they run in parallel). Use subagent_type = agent, description = description, prompt = prompt exactly. When each finishes (result or background notification), call activation_done with its activation_id and the agent’s final report, then call next_work again.',
              activations: claim.activations,
            },
            null,
            2,
          ),
        );
      }
      return text(JSON.stringify({ ...claim, dashboard: dashboardUrl() }, null, 2));
    }),
);

server.registerTool(
  'activation_done',
  {
    title: 'Report a finished Olympus activation',
    description: 'Report that an employee subagent has finished. Pass its final report text.',
    inputSchema: {
      activation_id: z.string().min(1).max(64),
      report: z.string().max(20000).describe('The subagent’s final report, copied as it is'),
    },
  },
  ({ activation_id, report }) =>
    guarded(async () => {
      const res = await daemonFetch<AgentToolResponse>('/api/host/done', { activation_id, report });
      return text(res.text, !res.ok);
    }),
);

// ───────────── Owner actions ─────────────

server.registerTool(
  'company_status',
  {
    title: 'Olympus status',
    description: 'Show the project and its phase, the PRD status, the task board, who is in the company and what they are doing, and the dashboard link.',
    inputSchema: {},
  },
  () =>
    guarded(async () => {
      const s = await ownerCall<CompanyState>('/api/state');
      const active = s.employees.filter((e) => e.status !== 'fired');
      const nameOf = (id: string | null) => (id ? s.employees.find((e) => e.id === id)?.name ?? id : 'the Owner');
      const people = active
        .map((e) => `- ${e.name} (id ${e.id}), ${e.title}, reports to ${nameOf(e.managerId)}: ${e.status} · ${e.activity}`)
        .join('\n');
      const prd = s.project?.prd.at(-1);
      const done = s.tasks.filter((t) => t.status === 'done').length;
      const lines = [
        s.project ? `Project: ${s.project.title} · phase ${s.project.phase}` : 'No project yet.',
        prd ? `PRD v${prd.version} “${prd.title}”: ${prd.status.replace('_', ' ')}` : 'No PRD yet.',
        `Tasks: ${done}/${s.tasks.length} done`,
        `Mode: ${s.settings.mode} · agent runs this project: ${s.activationsThisProject}/${s.settings.maxActivationsPerProject}`,
        s.waitingFor === 'owner_prd' ? 'Waiting for: the Owner to decide on the PRD.' : s.waitingFor === 'claude_code' ? 'Waiting for: Claude Code to run /olympus:run.' : '',
        `Team:\n${people}`,
        s.proposals.length ? `Proposed hires: ${s.proposals.map((p) => `${p.name} (${p.roleId}, ${p.level})`).join(', ')}` : '',
        `Dashboard: ${dashboardUrl()}`,
      ];
      return text(lines.filter(Boolean).join('\n'));
    }),
);

server.registerTool(
  'owner_message',
  {
    title: 'Message the CEO (as the Owner)',
    description: 'Send the Olympus CEO a message from the Owner: an instruction, an answer to their question, or a change. Then run the work loop so the CEO acts on it.',
    inputSchema: { text: z.string().min(1).max(4000) },
  },
  ({ text: body }) =>
    guarded(async () => {
      await ownerCall('/api/owner/message', { text: body });
      return text('Delivered to the CEO. Run the work loop (next_work) so they act on it.');
    }),
);

server.registerTool(
  'get_prd',
  {
    title: 'Read the latest PRD',
    description: 'Return the latest PRD the CEO submitted: version, title, status, the Owner’s last comment, and the full Markdown.',
    inputSchema: {},
  },
  () =>
    guarded(async () => {
      const s = await ownerCall<CompanyState>('/api/state');
      const prd = s.project?.prd.at(-1);
      if (!s.project) return text('There is no project yet. Start one with /olympus:brief.');
      if (!prd) return text(`Project “${s.project.title}” has no PRD yet; the CEO is still writing it.`);
      return text(
        `PRD v${prd.version} “${prd.title}” · status: ${prd.status.replace('_', ' ')}${prd.ownerComment ? ` · Owner’s comment: ${prd.ownerComment}` : ''}\n\n${prd.markdown}`,
      );
    }),
);

server.registerTool(
  'decide_prd',
  {
    title: 'Approve the PRD or ask for changes (as the Owner)',
    description: 'The Owner’s decision on the PRD that is waiting. "approve" lets the team hire and build; "changes" sends it back to the CEO with the comment. Only call this when the Owner said so.',
    inputSchema: {
      decision: z.enum(['approve', 'changes']),
      comment: z.string().max(4000).optional().describe('The Owner’s note; required for "changes"'),
    },
  },
  ({ decision, comment }) =>
    guarded(async () => {
      await ownerCall('/api/project/prd/decision', { decision, comment: comment ?? null });
      return text(
        decision === 'approve'
          ? 'PRD approved. The CEO and HR will now hire and plan. Run the work loop (next_work).'
          : 'Changes requested. The CEO will revise the PRD. Run the work loop (next_work).',
      );
    }),
);

server.registerTool(
  'owner_hire',
  {
    title: 'Hire someone (as the Owner)',
    description: 'Hire a person into Olympus directly, for example a new CEO or Head of HR. CEO, HR and CTO have one seat each. Role ids: ceo, hr, cto, designer, writer, tech-lead, architect, qa, devops, security, database, data-ml, frontend, backend-node, backend-python, fullstack.',
    inputSchema: {
      role: z.string().min(2).max(40),
      name: z.string().max(60).optional(),
      level: z.enum(['sde1', 'sde2', 'senior', 'mts']).optional(),
    },
  },
  ({ role, name, level }) =>
    guarded(async () => {
      const res = await ownerCall<{ employee: { name: string; title: string; id: string; managerId: string | null } }>(
        '/api/employees/hire',
        { roleId: role, name: name ?? null, level: level ?? null },
      );
      const e = res.employee;
      return text(`${e.name} joined as ${e.title} (id ${e.id}), reporting to ${e.managerId ?? 'the Owner'}.`);
    }),
);

server.registerTool(
  'owner_fire',
  {
    title: 'Fire someone (as the Owner)',
    description: 'Fire an Olympus employee by id or name, with a reason. Their open tasks go back to the board.',
    inputSchema: {
      employee: z.string().min(1).max(60).describe('Employee id (like "hr") or name (like "Meera")'),
      reason: z.string().max(300).optional(),
    },
  },
  ({ employee, reason }) =>
    guarded(async () => {
      const s = await ownerCall<CompanyState>('/api/state');
      const q = employee.trim().toLowerCase();
      const active = s.employees.filter((e) => e.status !== 'fired');
      const matches = active.filter(
        (e) => e.id.toLowerCase() === q || e.name.toLowerCase() === q || e.name.toLowerCase().split(' ')[0] === q,
      );
      if (matches.length !== 1) {
        return text(
          matches.length === 0
            ? `Nobody active matches “${employee}”. Active: ${active.map((e) => `${e.name} (${e.id})`).join(', ')}.`
            : `“${employee}” matches several people: ${matches.map((e) => `${e.name} (${e.id})`).join(', ')}. Use the id.`,
          true,
        );
      }
      const target = matches[0]!;
      await daemonFetch(`/api/employees/${encodeURIComponent(target.id)}/fire`, { reason: reason?.trim() || 'Owner decision' });
      return text(`${target.name} (${target.title}) was fired.`);
    }),
);

// ───────────── Company tools (employee subagents) ─────────────

const activation = z.string().min(1).max(64).describe('Your activation id, from the top of your instructions');

async function agentTool(name: string, activationId: string, input: Record<string, unknown>): Promise<CallToolResult> {
  return guarded(async () => {
    const res = await daemonFetch<AgentToolResponse>('/api/agent/tool', { activation: activationId, tool: name, input });
    return text(res.text, !res.ok);
  });
}

const employee = (name: string, title: string, description: string, shape: z.ZodRawShape) =>
  server.registerTool(
    name,
    { title, description: `Olympus employees only. ${description}`, inputSchema: { activation, ...shape } },
    (args: Record<string, unknown>) => {
      const { activation: id, ...input } = args as { activation: string } & Record<string, unknown>;
      return agentTool(name, id, input);
    },
  );

employee('post_message', 'Send a company message',
  '`to` is an employee id (from list_team), the channel "#general", or "owner" (CEO only). A direct message wakes the recipient up, so only send one when you need or deliver something.',
  { to: z.string().min(1).max(64), text: z.string().min(1).max(6000) });

employee('report_status', 'Set your dashboard status', 'Set the one-line status the Owner sees on the dashboard.',
  { summary: z.string().min(1).max(160) });

employee('list_team', 'List the team', 'Everyone in the company, who they report to, proposed hires, and the role ids.', {});

employee('get_project', 'Read the project', 'The brief, phase, project folder, task progress and the PRD.', {});

employee('list_tasks', 'Read the task board', 'Every task with its status, owner and last note.', {});

employee('create_task', 'Create a task (leads)',
  'CEO, CTO, Tech Lead or Architect only, after the PRD is approved. One owner per task; put acceptance criteria and the files they own in the description.',
  { title: z.string().min(1).max(120), description: z.string().max(4000), assignee: z.string().min(1).max(64).describe('Employee id') });

employee('update_task', 'Update a task',
  'Move your task to in_progress, review, blocked (say why) or done (say what you built and how you checked it). Leads can update any task and reassign it with `assignee`.',
  {
    task_id: z.string().min(1).max(16),
    status: z.enum(['todo', 'in_progress', 'review', 'blocked', 'done']),
    note: z.string().max(1000).optional(),
    assignee: z.string().max(64).optional().describe('Leads only: reassign to this employee id'),
  });

employee('submit_prd', 'Submit the PRD (CEO)',
  'CEO only. Submit a new PRD version for the Owner to approve. Write the full PRD in Markdown.',
  { title: z.string().min(1).max(120), markdown: z.string().min(40).max(40000) });

employee('propose_team', 'Propose hires (HR)',
  'HR only. Record a staffing proposal; it replaces any earlier one. Nobody is hired until the Owner approves the PRD.',
  {
    hires: z
      .array(
        z.object({
          role: z.string().describe('Role id, for example "tech-lead", "frontend", "backend-node", "qa"'),
          name: z.string().min(2).max(60),
          level: z.enum(['sde1', 'sde2', 'senior', 'mts']),
          reason: z.string().max(200),
        }),
      )
      .min(1)
      .max(12),
  });

employee('hire_team', 'Hire the proposed team (HR)',
  'HR only, after the Owner approves the PRD. Hires every proposed person, or only the proposal ids given.',
  { proposal_ids: z.array(z.string()).optional() });

await server.connect(new StdioServerTransport());
