import { randomBytes } from 'node:crypto';
import type {
  ChatMessage,
  CompanyState,
  DemoState,
  Employee,
  EmployeeId,
  EmployeeStatus,
  HostClaimResponse,
  ProposedHire,
  RuntimeMode,
} from '@olympus/shared';
import type { DaemonConfig } from './config.js';
import type { EventBus } from './events.js';
import { FOUNDING_ROLE_IDS, LEVELS, ORG_ROLES, modelFor, roleById } from './org.js';
import {
  CHANNELS,
  FOUNDING_TEAM,
  OWNER_ID,
  activationPrompt,
  agentTypeFor,
  hrOnboardingMessage,
} from './prompts.js';
import type { HostRuntime } from './runtime/host.js';
import type {
  ActivationResult,
  AgentRuntime,
  CompanyTools,
  HireProposalInput,
  InboxItem,
  ToolResult,
} from './runtime/types.js';

const MAX_MESSAGES_IN_STATE = 500;
const MAX_PROPOSED_HIRES = 12;

export class CompanyError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface Member {
  data: Employee;
  inbox: InboxItem[];
  controller: AbortController | null;
  runActivations: number;
}

export interface CompanyOptions {
  config: Pick<
    DaemonConfig,
    'companyName' | 'maxConcurrency' | 'maxActivationsPerEmployee' | 'maxActivationsPerRun' | 'models'
  >;
  bus: EventBus;
  runtimes: { host: HostRuntime | null; simulated: AgentRuntime };
}

/**
 * The company: employees, their inboxes, and the scheduler that activates them.
 * Employees are actors: a direct message lands in the recipient's inbox, and the scheduler
 * starts an activation for every idle employee with unread messages, up to the limits.
 * Nothing polls. Every rule an agent could break is checked here, in code.
 */
export class Company {
  private members = new Map<EmployeeId, Member>();
  private messages: ChatMessage[] = [];
  private proposals: ProposedHire[] = [];
  private nextMessageId = 1;
  private activationsThisRun = 0;
  private demo: DemoState = idleDemo();
  private runtime: AgentRuntime | null = null;
  /** Bumped on every reset so activations from an earlier run can't write into a new one. */
  private generation = 0;
  private scheduleQueued = false;
  private runLimitNoticeSent = false;

  constructor(private readonly opts: CompanyOptions) {
    this.hireFoundingTeam();
  }

  snapshot(): CompanyState {
    const { config } = this.opts;
    const host = this.opts.runtimes.host?.counts() ?? { waiting: 0, running: 0, lastSeenAt: null };
    return {
      companyName: config.companyName,
      limits: {
        maxConcurrency: config.maxConcurrency,
        maxActivationsPerEmployee: config.maxActivationsPerEmployee,
        maxActivationsPerRun: config.maxActivationsPerRun,
      },
      activationsThisRun: this.activationsThisRun,
      roles: ORG_ROLES,
      employees: [...this.members.values()].map((m) => ({ ...m.data })),
      proposals: [...this.proposals],
      messages: this.messages.slice(-MAX_MESSAGES_IN_STATE),
      demo: { ...this.demo },
      host,
    };
  }

  /** Starts a fresh run: new founding team, the Owner's brief to the CEO, onboarding to HR. */
  startDemo(brief: string, mode: RuntimeMode): void {
    if (this.demo.running) {
      throw new CompanyError(409, 'A run is already in progress. Reset it first.');
    }
    const runtime = mode === 'claude-code' ? this.opts.runtimes.host : this.opts.runtimes.simulated;
    if (!runtime) throw new CompanyError(400, 'Claude Code mode is not available.');
    this.reset();
    this.runtime = runtime;
    this.demo = { running: true, mode, brief, startedAt: new Date().toISOString(), finishedAt: null };
    this.opts.bus.emit({ type: 'demo.started', mode, brief });
    this.deliver(OWNER_ID, 'ceo', brief);
    this.deliver('system', 'hr', hrOnboardingMessage(this.opts.config.companyName));
    this.scheduleSoon();
  }

  /** Stops everything and brings back a fresh founding team. */
  reset(): void {
    this.generation++;
    for (const member of this.members.values()) member.controller?.abort();
    this.members.clear();
    this.messages = [];
    this.proposals = [];
    this.nextMessageId = 1;
    this.activationsThisRun = 0;
    this.runLimitNoticeSent = false;
    this.demo = idleDemo();
    this.runtime = null;
    this.hireFoundingTeam();
    this.opts.bus.emit({ type: 'company.reset' });
  }

  fire(employeeId: EmployeeId, reason: string): void {
    const member = this.members.get(employeeId);
    if (!member) throw new CompanyError(404, `No employee with id "${employeeId}".`);
    if (member.data.status === 'fired') {
      throw new CompanyError(409, `${member.data.name} has already left the company.`);
    }
    const wasWorking = member.controller !== null;
    member.inbox = [];
    member.data.status = 'fired';
    member.data.firedReason = reason;
    member.data.activity = 'Left the company';
    member.controller?.abort();
    this.opts.bus.emit({ type: 'employee.fired', employeeId, reason });
    this.opts.bus.emit({ type: 'employee.status_changed', employeeId, status: 'fired', activity: member.data.activity });
    this.post(
      'system',
      '#general',
      `${member.data.name} (${member.data.title}) has left the company${wasWorking ? ' mid-task' : ''}. Reason: ${reason}`,
    );
    this.scheduleSoon();
  }

  /** The Claude Code session asks for work (/olympus:brief and /olympus:run call this in a loop). */
  hostClaim(): HostClaimResponse {
    const host = this.opts.runtimes.host;
    if (!host) return { status: 'no_run', message: 'Claude Code mode is not available.' };
    if (this.demo.mode !== 'claude-code') {
      return { status: 'no_run', message: 'No Claude Code run is in progress. Start one with /olympus:brief <what to build>.' };
    }
    const activations = host.claim();
    if (activations.length > 0) {
      this.opts.bus.emit({ type: 'host.claimed', activationIds: activations.map((a) => a.activation_id) });
      return { status: 'work', activations };
    }
    const { running } = host.counts();
    if (running > 0) {
      return {
        status: 'busy',
        running,
        message: `${running} activation(s) are still running. When each agent returns, call activation_done for it, then call next_work again.`,
      };
    }
    if (!this.demo.running) {
      const ownerMessages = this.messages
        .filter((m) => m.to === OWNER_ID && m.from !== 'system')
        .map((m) => `${this.labelFor(m.from)}: ${m.text}`);
      return {
        status: 'finished',
        message: 'The run is finished: nobody has unread work. Tell the Owner what the CEO reported.',
        ownerMessages,
      };
    }
    return { status: 'busy', running: 0, message: 'The company is between steps. Call next_work again.' };
  }

  hostDone(activationId: string, report: string): boolean {
    return this.opts.runtimes.host?.done(activationId, report) ?? false;
  }

  hostTool(activationId: string, tool: string, input: Record<string, unknown>): ToolResult {
    const host = this.opts.runtimes.host;
    if (!host) return { ok: false, text: 'Claude Code mode is not available.' };
    return host.tool(activationId, tool, input);
  }

  /** Stops all running activations, for shutdown. */
  shutdown(): void {
    this.generation++;
    for (const member of this.members.values()) member.controller?.abort();
  }

  private hireFoundingTeam(): void {
    const { models } = this.opts.config;
    for (const founder of FOUNDING_TEAM) {
      const role = roleById(founder.roleId)!;
      this.members.set(founder.id, {
        data: {
          id: founder.id,
          name: founder.name,
          roleId: role.id,
          title: role.title,
          managerId: founder.managerId,
          model: models[founder.id].model,
          effort: models[founder.id].effort,
          status: 'idle',
          activity: 'Waiting for work',
          activations: 0,
          lastDurationMs: null,
        },
        inbox: [],
        controller: null,
        runActivations: 0,
      });
    }
  }

  private roster(): string {
    return [...this.members.values()]
      .map((m) => {
        const manager = m.data.managerId ? this.members.get(m.data.managerId)?.data.name : 'the Owner';
        const left = m.data.status === 'fired' ? ' (no longer works here)' : '';
        return `- ${m.data.name}, ${m.data.title}: id "${m.data.id}", reports to ${manager}${left}`;
      })
      .join('\n');
  }

  /** A direct message into an employee's inbox, from the Owner or the system. */
  private deliver(from: 'owner' | 'system', to: EmployeeId, text: string): void {
    const result = this.post(from, to, text);
    if (!result.ok) throw new CompanyError(400, result.text);
  }

  /** Posts a message. Checks every rule here, so agents can't skip them. */
  private post(from: ChatMessage['from'], to: string, rawText: string): ToolResult {
    const text = rawText.trim();
    if (!text) return { ok: false, text: 'The message is empty.' };
    if (text.length > 4000) return { ok: false, text: 'The message is too long (max 4000 characters).' };

    let recipient: Member | null = null;
    let label: string;
    if (to === OWNER_ID) {
      if (from !== 'ceo' && from !== 'system') {
        return { ok: false, text: 'Only the CEO messages the Owner. Send this to the CEO ("ceo") instead.' };
      }
      label = 'the Owner';
    } else if (to.startsWith('#')) {
      if (!(CHANNELS as readonly string[]).includes(to)) {
        return { ok: false, text: `Unknown channel "${to}". Channels: ${CHANNELS.join(', ')}.` };
      }
      label = to;
    } else {
      recipient = this.members.get(to) ?? null;
      if (!recipient) return { ok: false, text: `No employee with id "${to}". Call list_team to see ids.` };
      if (to === from) return { ok: false, text: 'You cannot message yourself.' };
      if (recipient.data.status === 'fired') return { ok: false, text: `${recipient.data.name} no longer works here.` };
      label = recipient.data.name;
    }

    const message: ChatMessage = { id: this.nextMessageId++, ts: new Date().toISOString(), from, to, text };
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES_IN_STATE * 2) this.messages = this.messages.slice(-MAX_MESSAGES_IN_STATE);
    this.opts.bus.emit({ type: 'message.posted', message });

    if (recipient) {
      recipient.inbox.push({ from, fromLabel: this.labelFor(from), text, ts: message.ts });
      if (!recipient.controller) this.setStatus(recipient, 'queued', 'New message waiting');
      this.scheduleSoon();
    }
    return { ok: true, text: `Delivered to ${label}.` };
  }

  private proposeTeam(from: EmployeeId, hires: HireProposalInput[]): ToolResult {
    const member = this.members.get(from);
    if (member?.data.roleId !== 'hr') return { ok: false, text: 'Only HR can propose hires.' };
    if (!Array.isArray(hires) || hires.length === 0) return { ok: false, text: 'Propose at least one hire.' };
    if (hires.length > MAX_PROPOSED_HIRES) return { ok: false, text: `Propose at most ${MAX_PROPOSED_HIRES} hires.` };

    const validRoles = ORG_ROLES.filter((r) => !FOUNDING_ROLE_IDS.has(r.id)).map((r) => r.id);
    const proposals: ProposedHire[] = [];
    for (const [i, hire] of hires.entries()) {
      const role = typeof hire?.role === 'string' ? roleById(hire.role) : undefined;
      if (!role || FOUNDING_ROLE_IDS.has(role.id)) {
        return { ok: false, text: `Hire ${i + 1}: unknown role "${String(hire?.role)}". Valid roles: ${validRoles.join(', ')}.` };
      }
      if (!LEVELS.includes(hire.level)) {
        return { ok: false, text: `Hire ${i + 1}: level must be one of ${LEVELS.join(', ')}.` };
      }
      const name = String(hire.name ?? '').trim();
      if (name.length < 2 || name.length > 60) return { ok: false, text: `Hire ${i + 1}: give a name (2–60 characters).` };
      proposals.push({
        id: `p${i + 1}`,
        roleId: role.id,
        name,
        level: hire.level,
        model: modelFor(role, hire.level),
        reason: String(hire.reason ?? '').trim().slice(0, 200),
        proposedBy: from,
        ts: new Date().toISOString(),
      });
    }
    this.proposals = proposals;
    this.opts.bus.emit({ type: 'team.proposed', employeeId: from, count: proposals.length });
    return {
      ok: true,
      text: `Recorded ${proposals.length} proposed hires. They appear on the Owner's org chart as "Proposed" under their managers. Nobody is hired until the Owner approves the PRD.`,
    };
  }

  private toolsFor(employeeId: EmployeeId, generation: number): CompanyTools {
    const guard = (): ToolResult | null => {
      const member = this.members.get(employeeId);
      if (generation !== this.generation || !member) return { ok: false, text: 'This run has ended.' };
      if (member.data.status === 'fired') return { ok: false, text: 'You no longer work here. Stop now.' };
      return null;
    };
    return {
      postMessage: (to, text) => guard() ?? this.post(employeeId, to.trim(), text),
      reportStatus: (summary) => {
        const blocked = guard();
        if (blocked) return blocked;
        const member = this.members.get(employeeId)!;
        this.setStatus(member, member.data.status, summary.trim().slice(0, 160) || member.data.activity);
        return { ok: true, text: 'Status updated.' };
      },
      listTeam: () => {
        const blocked = guard();
        if (blocked) return blocked;
        const roles = ORG_ROLES.filter((r) => !FOUNDING_ROLE_IDS.has(r.id))
          .map((r) => `- ${r.id}: ${r.title}, reports to ${r.reportsTo ?? 'the Owner'}`)
          .join('\n');
        return { ok: true, text: `Team:\n${this.roster()}\n\nRoles HR can propose (role id: title):\n${roles}` };
      },
      proposeTeam: (hires) => guard() ?? this.proposeTeam(employeeId, hires),
    };
  }

  private scheduleSoon(): void {
    if (this.scheduleQueued) return;
    this.scheduleQueued = true;
    queueMicrotask(() => {
      this.scheduleQueued = false;
      this.schedule();
    });
  }

  private schedule(): void {
    if (!this.demo.running || !this.runtime) return;
    const { maxConcurrency, maxActivationsPerEmployee, maxActivationsPerRun } = this.opts.config;

    for (const member of this.members.values()) {
      if (member.data.status === 'fired' || member.controller || member.inbox.length === 0) continue;
      if (this.runningCount() >= maxConcurrency) break;

      if (this.activationsThisRun >= maxActivationsPerRun) {
        if (!this.runLimitNoticeSent) {
          this.runLimitNoticeSent = true;
          this.notice('warning', `This run reached its limit of ${maxActivationsPerRun} agent runs. No new activations will start.`);
        }
        this.dropInbox(member, 'Paused: run limit reached');
        continue;
      }
      if (member.runActivations >= maxActivationsPerEmployee) {
        this.notice(
          'warning',
          `${member.data.name} reached the limit of ${maxActivationsPerEmployee} activations per run. ${member.inbox.length} message(s) left unread.`,
        );
        this.dropInbox(member, 'Activation limit reached');
        continue;
      }
      void this.activate(member);
    }
    this.finishIfQuiet();
  }

  private async activate(member: Member): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) return;
    const generation = this.generation;
    const employeeId = member.data.id;
    const inbox = member.inbox.splice(0);
    const controller = new AbortController();
    const activationId = `a_${randomBytes(6).toString('hex')}`;
    member.controller = controller;
    member.runActivations++;
    member.data.activations++;
    this.activationsThisRun++;

    const trigger = describeTrigger(inbox);
    const waitingForHost = runtime.mode === 'claude-code';
    this.setStatus(member, 'working', waitingForHost ? `Waiting for Claude Code to pick up ${trigger}` : `Reading ${trigger}`);
    this.opts.bus.emit({ type: 'activation.started', employeeId, activationId, trigger });

    const firstName = member.data.name.split(' ')[0] ?? member.data.name;
    let result: ActivationResult;
    try {
      result = await runtime.run({
        activationId,
        employee: { ...member.data },
        agentType: agentTypeFor(member.data.roleId),
        description: `${firstName} (${member.data.title}): ${trigger}`,
        prompt: activationPrompt({
          companyName: this.opts.config.companyName,
          name: member.data.name,
          title: member.data.title,
          employeeId,
          activationId,
          roster: this.roster(),
          inbox,
        }),
        inbox,
        abortController: controller,
        tools: this.toolsFor(employeeId, generation),
        emit: (event) => {
          if (generation !== this.generation || member.data.status === 'fired') return;
          if (event.kind === 'note') {
            this.opts.bus.emit({ type: 'agent.note', employeeId, text: event.text });
          } else {
            this.opts.bus.emit({ type: 'agent.action', employeeId, tool: event.tool, summary: event.summary });
            if (event.tool !== 'report_status') this.setStatus(member, 'working', event.summary);
          }
        },
      });
    } catch (err) {
      const aborted = controller.signal.aborted;
      result = {
        outcome: aborted ? 'aborted' : 'error',
        durationMs: 0,
        detail: aborted ? 'Stopped by the company.' : err instanceof Error ? err.message : String(err),
      };
    }

    if (generation !== this.generation) return;
    member.controller = null;
    member.data.lastDurationMs = result.durationMs;
    if (result.requeue && member.data.status !== 'fired') {
      member.inbox.unshift(...inbox);
      member.runActivations--;
      this.activationsThisRun--;
    }
    this.opts.bus.emit({
      type: 'activation.completed',
      employeeId,
      activationId,
      outcome: result.outcome,
      durationMs: result.durationMs,
      ...(result.detail ? { detail: result.detail } : {}),
    });
    if (result.outcome === 'error') {
      this.notice('error', `${member.data.name}'s run failed: ${result.detail ?? 'unknown error'}`);
    }
    if (member.data.status !== 'fired') {
      const activity = result.outcome === 'success' ? 'Done, waiting for messages' : `Stopped (${result.outcome})`;
      this.setStatus(member, member.inbox.length > 0 ? 'queued' : 'idle', activity);
    }
    this.scheduleSoon();
  }

  private finishIfQuiet(): void {
    if (!this.demo.running) return;
    const busy = [...this.members.values()].some(
      (m) => m.controller !== null || (m.data.status !== 'fired' && m.inbox.length > 0),
    );
    if (busy) return;
    this.demo = { ...this.demo, running: false, finishedAt: new Date().toISOString() };
    this.opts.bus.emit({ type: 'demo.finished', activations: this.activationsThisRun });
  }

  private dropInbox(member: Member, activity: string): void {
    member.inbox = [];
    this.setStatus(member, 'idle', activity);
  }

  private setStatus(member: Member, status: EmployeeStatus, activity: string): void {
    if (member.data.status === 'fired' && status !== 'fired') return;
    member.data.status = status;
    member.data.activity = activity;
    this.opts.bus.emit({ type: 'employee.status_changed', employeeId: member.data.id, status, activity });
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.opts.bus.emit({ type: 'system.notice', level, text });
  }

  private runningCount(): number {
    let count = 0;
    for (const member of this.members.values()) if (member.controller) count++;
    return count;
  }

  private labelFor(from: ChatMessage['from']): string {
    if (from === OWNER_ID) return 'the Owner';
    if (from === 'system') return 'the company system';
    const member = this.members.get(from);
    return member ? `${member.data.name} (${member.data.title}, id "${member.data.id}")` : from;
  }
}

function idleDemo(): DemoState {
  return { running: false, mode: null, brief: null, startedAt: null, finishedAt: null };
}

function describeTrigger(inbox: InboxItem[]): string {
  const senders = [...new Set(inbox.map((item) => item.fromLabel.split(' (')[0]))];
  return `${inbox.length} message${inbox.length === 1 ? '' : 's'} from ${senders.join(', ')}`;
}
