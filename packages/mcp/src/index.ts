#!/usr/bin/env node
// Olympus plugin MCP server (stdio). Claude Code starts it for every session that has the plugin.
// Two groups of tools:
//  - the work loop, used by the Owner's session: start_run, next_work, activation_done, company_status
//  - company tools, used by employee subagents: post_message, report_status, list_team, propose_team
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

const server = new McpServer(
  { name: 'olympus-company', version: '0.0.1' },
  {
    instructions:
      'Olympus runs an AI software company inside this Claude Code session. The Owner starts work with /olympus:brief; the session then runs the work loop (next_work → Agent calls → activation_done). The post_message, report_status, list_team and propose_team tools belong to Olympus employee subagents and need their activation id.',
  },
);

// ---- Work loop (the Owner's session) ----

server.registerTool(
  'start_run',
  {
    title: 'Start a Olympus run',
    description:
      'Start Olympus (if needed) and give the CEO a new product brief from the Owner. Resets the previous run. Returns the dashboard link. After this, call next_work.',
    inputSchema: { brief: z.string().min(5).max(2000).describe('What the Owner wants built, in their words') },
  },
  ({ brief }) =>
    guarded(async () => {
      const up = await ensureDaemon();
      if (!up.ok) return text(up.error, true);
      await daemonFetch('/api/demo/start', { brief, mode: 'claude-code' });
      return text(
        `Run started. The CEO has the brief and HR is onboarding.\nDashboard (share the full link with the Owner): ${dashboardUrl()}\nNext: call next_work.`,
      );
    }),
);

server.registerTool(
  'next_work',
  {
    title: 'Get Olympus work to run',
    description:
      'Get the employee activations that are ready to run. For each one, start an Agent call with subagent_type = agent, description = description and prompt = prompt (copied exactly), all in one message so they run in parallel. When each agent returns, call activation_done. Repeat until the status is "finished" or "no_run".',
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
                'Start one Agent call per activation below in this same message (they run in parallel). Use subagent_type = agent, description = description, prompt = prompt exactly. When each returns, call activation_done with its activation_id and the agent’s final report, then call next_work again.',
              activations: claim.activations,
            },
            null,
            2,
          ),
        );
      }
      return text(JSON.stringify(claim, null, 2));
    }),
);

server.registerTool(
  'activation_done',
  {
    title: 'Report a finished Olympus activation',
    description: 'Report that an employee subagent has returned. Pass its final report text.',
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

server.registerTool(
  'company_status',
  {
    title: 'Olympus status',
    description: 'Show who is in the company, what they are doing, and the state of the current run.',
    inputSchema: {},
  },
  () =>
    guarded(async () => {
      const state = await daemonFetch<CompanyState>('/api/state');
      const people = state.employees
        .map((e) => `- ${e.name}, ${e.title} (${e.status}): ${e.activity}`)
        .join('\n');
      const proposed = state.proposals.map((p) => `- ${p.name}: ${p.roleId} (${p.level})`).join('\n');
      const run = state.demo.running ? `running (${state.demo.mode})` : state.demo.finishedAt ? 'finished' : 'idle';
      return text(
        `Run: ${run} · ${state.activationsThisRun} agent runs\nTeam:\n${people}${proposed ? `\nProposed hires:\n${proposed}` : ''}\nDashboard: ${dashboardUrl()}`,
      );
    }),
);

// ---- Company tools (employee subagents) ----

const activation = z
  .string()
  .min(1)
  .max(64)
  .describe('Your activation id, from the top of your instructions');

async function agentTool(name: string, activationId: string, input: Record<string, unknown>): Promise<CallToolResult> {
  return guarded(async () => {
    const res = await daemonFetch<AgentToolResponse>('/api/agent/tool', { activation: activationId, tool: name, input });
    return text(res.text, !res.ok);
  });
}

server.registerTool(
  'post_message',
  {
    title: 'Send a company message',
    description:
      'Olympus employees only. Send a message. `to` is an employee id (for example "ceo" or "hr"), the channel "#general", or "owner" (CEO only). A direct message wakes the recipient up, so only send one when you need or deliver something.',
    inputSchema: {
      activation,
      to: z.string().min(1).max(64).describe('Employee id, "#general", or "owner"'),
      text: z.string().min(1).max(4000),
    },
  },
  ({ activation: id, to, text: body }) => agentTool('post_message', id, { to, text: body }),
);

server.registerTool(
  'report_status',
  {
    title: 'Set your dashboard status',
    description: 'Olympus employees only. Set the one-line status the Owner sees on the dashboard.',
    inputSchema: { activation, summary: z.string().min(1).max(160) },
  },
  ({ activation: id, summary }) => agentTool('report_status', id, { summary }),
);

server.registerTool(
  'list_team',
  {
    title: 'List the team',
    description: 'Olympus employees only. List everyone in the company, who they report to, and the roles HR can propose.',
    inputSchema: { activation },
  },
  ({ activation: id }) => agentTool('list_team', id, {}),
);

server.registerTool(
  'propose_team',
  {
    title: 'Propose hires (HR)',
    description:
      'Olympus HR only. Record a staffing proposal. Each hire appears on the Owner’s org chart as "Proposed" under its manager. Replaces any earlier proposal. Nobody is hired until the Owner approves the PRD. Use list_team to see valid role ids.',
    inputSchema: {
      activation,
      hires: z
        .array(
          z.object({
            role: z.string().describe('Role id, for example "cto", "tech-lead", "frontend", "backend-node", "qa", "devops"'),
            name: z.string().min(2).max(60).describe('Persona name for the new hire'),
            level: z.enum(['sde1', 'sde2', 'senior', 'mts']),
            reason: z.string().max(200).describe('One line: why this hire'),
          }),
        )
        .min(1)
        .max(12),
    },
  },
  ({ activation: id, hires }) => agentTool('propose_team', id, { hires }),
);

await server.connect(new StdioServerTransport());
