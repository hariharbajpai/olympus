import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  ChatMessage,
  CompanyState,
  Effort,
  Employee,
  EmployeeId,
  EmployeeStatus,
  HostClaimResponse,
  Level,
  Metrics,
  Project,
  ProjectPhase,
  ProposedHire,
  Settings,
  Task,
  TaskStatus,
} from '@olympus/shared';
import type { EventBus } from './events.js';
import {
  BUILDER_ROLES,
  FOUNDING_ROLE_IDS,
  LEVELS,
  ORG_ROLES,
  PERSONA_NAMES,
  TASK_LEAD_ROLES,
  WORK_LEAD_ROLES,
  modelFor,
  roleById,
} from './org.js';
import { CHANNELS, FOUNDING_TEAM, OWNER_ID, activationPrompt, agentTypeFor } from './prompts.js';
import type { HostRuntime } from './runtime/host.js';
import type { ActivationResult, AgentRuntime, CompanyTools, InboxItem, InboxKind, ToolResult } from './runtime/types.js';

const MAX_MESSAGES = 1000;
const MAX_METRIC_POINTS = 5000;
const MAX_PROPOSED_HIRES = 12;
const SINGLE_SEAT_ROLES = new Set(['ceo', 'hr', 'cto']);
const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'blocked', 'done'];

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
  projectActivations: number;
}

/** What survives a daemon restart (written to company.json). */
export interface SavedCompany {
  version: 1;
  members: Array<{ data: Employee; inbox: InboxItem[]; projectActivations: number }>;
  messages: ChatMessage[];
  proposals: ProposedHire[];
  project: Project | null;
  tasks: Task[];
  settings: Settings;
  metrics: Metrics;
  counters: { message: number; task: number };
  activationsThisProject: number;
}

export interface CompanyOptions {
  companyName: string;
  /** Root folder for project workspaces (each project gets a sub-folder). */
  projectsDir: string;
  settings: Settings;
  bus: EventBus;
  runtimes: { host: HostRuntime | null; simulated: AgentRuntime };
  persist?: { load(): SavedCompany | null; save(saved: SavedCompany): void };
}

/**
 * The company: employees, their inboxes, the project and its PRD, tasks, and the scheduler.
 * Employees are actors: a direct message lands in the recipient's inbox, and the scheduler starts
 * an activation for every idle employee with unread messages, up to the limits. Nothing polls.
 * Every rule an agent could break (who may hire, the PRD gate, who may create tasks) is checked here.
 */
export class Company {
  private members = new Map<EmployeeId, Member>();
  private messages: ChatMessage[] = [];
  private proposals: ProposedHire[] = [];
  private project: Project | null = null;
  private tasks: Task[] = [];
  private settings: Settings;
  private metrics: Metrics = emptyMetrics();
  private nextMessageId = 1;
  private nextTaskId = 1;
  private activationsThisProject = 0;
  /** Bumped on reset and new project so earlier activations can't write into the new state. */
  private generation = 0;
  private scheduleQueued = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private limitNoticeSent = false;
  private limitNoticed = new Set<EmployeeId>();

  constructor(private readonly opts: CompanyOptions) {
    this.settings = { ...opts.settings };
    const saved = opts.persist?.load() ?? null;
    if (saved) this.restore(saved);
    else this.hireFounders();
    this.scheduleSoon();
  }

  // ───────────────────────────── state for the dashboard ─────────────────────────────

  snapshot(): CompanyState {
    const host = this.opts.runtimes.host?.counts() ?? { waiting: 0, running: 0, lastSeenAt: null };
    const busy = this.isBusy();
    const latest = this.project?.prd.at(-1);
    let waitingFor: CompanyState['waitingFor'] = null;
    if (this.settings.mode === 'claude-code' && host.waiting > 0 && host.running === 0) waitingFor = 'claude_code';
    else if (!busy && latest?.status === 'pending') waitingFor = 'owner_prd';
    return {
      companyName: this.opts.companyName,
      settings: { ...this.settings },
      activationsThisProject: this.activationsThisProject,
      roles: ORG_ROLES,
      employees: [...this.members.values()].map((m) => ({ ...m.data, managerId: this.managerOf(m.data) })),
      proposals: [...this.proposals],
      project: this.project ? structuredClone(this.project) : null,
      tasks: structuredClone(this.tasks),
      messages: this.messages.slice(-500),
      host,
      metrics: {
        activations: this.metrics.activations.slice(-MAX_METRIC_POINTS),
        tasksDone: this.metrics.tasksDone.slice(-MAX_METRIC_POINTS),
        messages: this.metrics.messages.slice(-MAX_METRIC_POINTS),
      },
      busy,
      waitingFor,
    };
  }

  // ───────────────────────────── Owner actions ─────────────────────────────

  /** Starts a new project: the CEO gets the brief. The team stays; tasks and proposals start fresh. */
  startProject(brief: string): Project {
    const ceo = this.activeInRole('ceo');
    if (!ceo) throw new CompanyError(409, 'There is no CEO. Hire a CEO first (Org chart → Hire, or /olympus:hire ceo).');
    this.generation++;
    for (const member of this.members.values()) {
      member.controller?.abort();
      member.controller = null;
      member.inbox = [];
      member.projectActivations = 0;
      if (member.data.status !== 'fired') this.setStatus(member, 'idle', 'Waiting for work');
    }
    const id = randomBytes(3).toString('hex');
    const title = titleFromBrief(brief);
    const workspaceDir = path.join(this.opts.projectsDir, `${slugify(title)}-${id}`);
    mkdirSync(workspaceDir, { recursive: true });
    this.project = { id, title, brief, phase: 'planning', workspaceDir, startedAt: now(), prd: [] };
    this.tasks = [];
    this.proposals = [];
    this.metrics = emptyMetrics();
    this.activationsThisProject = 0;
    this.limitNoticeSent = false;
    this.limitNoticed.clear();
    this.nextTaskId = 1;
    this.opts.bus.emit({ type: 'project.started', projectId: id, title });
    this.post('system', '#general', `New project: “${title}”. The CEO has the Owner’s brief.`);
    this.deliver(OWNER_ID, ceo.data.id, brief, 'brief');
    this.changed();
    return structuredClone(this.project);
  }

  /** The Owner talks to the CEO (dashboard or /olympus:tell). */
  ownerMessage(text: string): void {
    const ceo = this.activeInRole('ceo');
    if (!ceo) throw new CompanyError(409, 'There is no CEO to talk to. Hire a CEO first.');
    this.deliver(OWNER_ID, ceo.data.id, text, 'owner');
    this.changed();
  }

  decidePrd(decision: 'approve' | 'changes', comment: string | null): void {
    const project = this.project;
    const latest = project?.prd.at(-1);
    if (!project || !latest) throw new CompanyError(409, 'There is no PRD to decide on yet.');
    if (latest.status !== 'pending') {
      throw new CompanyError(409, `PRD v${latest.version} is already ${latest.status.replace('_', ' ')}.`);
    }
    if (decision === 'changes' && !comment?.trim()) {
      throw new CompanyError(400, 'Say what should change, so the CEO can revise the PRD.');
    }
    latest.status = decision === 'approve' ? 'approved' : 'changes_requested';
    latest.ownerComment = comment?.trim() || null;
    latest.decidedAt = now();
    this.setPhase(decision === 'approve' ? 'approved' : 'planning');
    this.opts.bus.emit({
      type: 'prd.decided',
      version: latest.version,
      decision: latest.status as 'approved' | 'changes_requested',
      comment: latest.ownerComment,
    });
    const ceo = this.activeInRole('ceo');
    if (!ceo) {
      this.notice('warning', 'Decision recorded, but there is no CEO to act on it. Hire a CEO.');
    } else if (decision === 'approve') {
      this.deliver(
        'system',
        ceo.data.id,
        `The Owner approved PRD v${latest.version} “${latest.title}”.${latest.ownerComment ? ` Owner’s note: ${latest.ownerComment}` : ''}\nNext: ask HR (id "hr") to hire the proposed team with hire_team. Once they are hired, hand the PRD to the Tech Lead (or the CTO) to break it into tasks. If the team has no Tech Lead or CTO, create and assign the tasks yourself with create_task.`,
        'prd_approved',
      );
    } else {
      this.deliver(
        'system',
        ceo.data.id,
        `The Owner asked for changes to PRD v${latest.version} “${latest.title}”:\n${latest.ownerComment}\nRevise the PRD to address every point and submit it again with submit_prd.`,
        'prd_changes',
      );
    }
    this.changed();
  }

  /** The Owner hires someone directly (any role). CEO, HR and CTO have one seat each. */
  ownerHire(roleId: string, name?: string | null, level?: Level | null): Employee {
    const role = roleById(roleId);
    if (!role) throw new CompanyError(400, `Unknown role "${roleId}". Roles: ${ORG_ROLES.map((r) => r.id).join(', ')}.`);
    const existing = this.activeInRole(roleId);
    if (existing && SINGLE_SEAT_ROLES.has(roleId)) {
      throw new CompanyError(409, `${existing.data.name} is already the ${role.title}. Fire them first to hire someone new.`);
    }
    if (level && !LEVELS.includes(level)) throw new CompanyError(400, `Level must be one of ${LEVELS.join(', ')}.`);
    const member = this.hire(roleId, name?.trim() || this.freshName(), level ?? null, 'owner');
    // A new leader joining mid-project gets briefed so the work carries on.
    if (this.project && this.project.phase !== 'done' && ['ceo', 'hr', 'cto', 'tech-lead'].includes(roleId)) {
      this.deliver(
        'system',
        member.data.id,
        `You just joined as ${role.title}, hired by the Owner in the middle of the project “${this.project.title}”. Read get_project and list_tasks, check in with your team, and carry the work forward.`,
        'onboarding',
      );
    }
    this.changed();
    return { ...member.data, managerId: this.managerOf(member.data) };
  }

  fire(employeeId: EmployeeId, reason: string): void {
    const member = this.members.get(employeeId);
    if (!member) throw new CompanyError(404, `No employee with id "${employeeId}".`);
    if (member.data.status === 'fired') throw new CompanyError(409, `${member.data.name} has already left the company.`);
    const wasWorking = member.controller !== null;
    member.inbox = [];
    member.data.status = 'fired';
    member.data.firedReason = reason;
    member.data.firedAt = now();
    member.data.activity = 'Left the company';
    member.controller?.abort();
    this.opts.bus.emit({ type: 'employee.fired', employeeId, reason });
    this.opts.bus.emit({ type: 'employee.status_changed', employeeId, status: 'fired', activity: member.data.activity });
    this.post('system', '#general', `${member.data.name} (${member.data.title}) has left the company${wasWorking ? ' mid-task' : ''}. Reason: ${reason}`);

    const orphaned = this.tasks.filter((t) => t.assigneeId === employeeId && t.status !== 'done');
    for (const task of orphaned) {
      task.assigneeId = null;
      task.status = 'todo';
      task.updatedAt = now();
      task.notes.push({ ts: now(), by: 'system', text: `${member.data.name} left; task unassigned.`, status: 'todo' });
      this.opts.bus.emit({ type: 'task.updated', taskId: task.id, status: 'todo', by: 'system', note: 'unassigned' });
    }
    const lead = this.workLead();
    if (orphaned.length > 0 && lead) {
      this.deliver(
        'system',
        lead.data.id,
        `${member.data.name} left the company. These tasks are unassigned and back to todo: ${orphaned.map((t) => t.id).join(', ')}. Reassign them with update_task (assignee), or ask HR to hire a replacement.`,
        'task_update',
      );
    }
    this.changed();
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings, ...patch };
    if (next.mode !== 'claude-code' && next.mode !== 'simulated') throw new CompanyError(400, 'Mode must be claude-code or simulated.');
    for (const key of ['maxConcurrency', 'maxActivationsPerEmployee', 'maxActivationsPerProject'] as const) {
      if (!Number.isInteger(next[key]) || next[key] < 1 || next[key] > 500) {
        throw new CompanyError(400, `${key} must be a whole number from 1 to 500.`);
      }
    }
    this.settings = next;
    this.limitNoticeSent = false;
    this.limitNoticed.clear();
    this.opts.bus.emit({ type: 'settings.updated', settings: { ...next } });
    this.scheduleSoon();
    this.changed();
    return { ...next };
  }

  /** Back to day one: only the founding CEO and HR, no project. Settings are kept. */
  reset(): void {
    this.generation++;
    for (const member of this.members.values()) member.controller?.abort();
    this.members.clear();
    this.messages = [];
    this.proposals = [];
    this.project = null;
    this.tasks = [];
    this.metrics = emptyMetrics();
    this.nextMessageId = 1;
    this.nextTaskId = 1;
    this.activationsThisProject = 0;
    this.limitNoticeSent = false;
    this.hireFounders();
    this.opts.bus.emit({ type: 'company.reset' });
    this.changed();
  }

  // ───────────────────────────── Claude Code host loop ─────────────────────────────

  hostClaim(): HostClaimResponse {
    const host = this.opts.runtimes.host;
    if (!host || this.settings.mode !== 'claude-code') {
      return { status: 'no_run', message: 'Olympus is in simulated mode. Switch Settings → Runtime to Claude Code to run real agents.' };
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
    if (this.isBusy()) return { status: 'busy', running: 0, message: 'The company is between steps. Call next_work again.' };
    const paused = this.pausedByLimits();
    if (paused.length > 0) {
      return {
        status: 'finished',
        waitingFor: null,
        message: `Paused: ${paused.map((m) => m.data.name).join(', ')} still have unread work, but the agent-run limits are reached. Tell the Owner to raise them in Settings on the dashboard, then run /olympus:run.`,
        ownerMessages: [],
      };
    }
    if (!this.project) {
      return { status: 'no_run', message: 'There is no project yet. Start one with /olympus:brief <what to build>.' };
    }
    const latest = this.project.prd.at(-1);
    const since = this.project.startedAt;
    const ownerMessages = this.messages
      .filter((m) => m.to === OWNER_ID && m.ts >= since)
      .slice(-6)
      .map((m) => `${this.labelFor(m.from)}: ${m.text}`);
    if (latest?.status === 'pending') {
      return {
        status: 'finished',
        waitingFor: 'owner_prd',
        message: `PRD v${latest.version} “${latest.title}” is waiting for the Owner. They can read it on the dashboard (Project) or with /olympus:prd, then approve with /olympus:approve or ask for changes with /olympus:changes <what to change>.`,
        ownerMessages,
      };
    }
    return {
      status: 'finished',
      waitingFor: null,
      message:
        this.project.phase === 'done'
          ? 'The project is done: every task is complete. Tell the Owner what the CEO reported.'
          : 'Nobody has unread work right now. Tell the Owner what the CEO reported.',
      ownerMessages,
    };
  }

  hostDone(activationId: string, report: string): boolean {
    return this.opts.runtimes.host?.done(activationId, report) ?? false;
  }

  hostTool(activationId: string, tool: string, input: Record<string, unknown>): ToolResult {
    const host = this.opts.runtimes.host;
    if (!host) return { ok: false, text: 'Claude Code mode is not available.' };
    return host.tool(activationId, tool, input);
  }

  /** Stops all running activations and writes state, for shutdown. */
  shutdown(): void {
    this.generation++;
    for (const member of this.members.values()) member.controller?.abort();
    this.saveNow();
  }

  // ───────────────────────────── employee tools ─────────────────────────────

  private callTool(employeeId: EmployeeId, tool: string, input: Record<string, unknown>): ToolResult {
    const me = this.members.get(employeeId);
    if (!me || me.data.status === 'fired') return { ok: false, text: 'You no longer work here. Stop now.' };
    const str = (key: string, max = 4000) => (typeof input[key] === 'string' ? (input[key] as string).trim().slice(0, max) : '');
    const role = me.data.roleId;

    switch (tool) {
      case 'post_message':
        return this.post(employeeId, str('to', 64), str('text', 4000));

      case 'report_status': {
        const summary = str('summary', 160);
        this.setStatus(me, me.data.status, summary || me.data.activity);
        return { ok: true, text: 'Status updated.' };
      }

      case 'list_team': {
        const roles = ORG_ROLES.filter((r) => !FOUNDING_ROLE_IDS.has(r.id))
          .map((r) => `- ${r.id}: ${r.title} (reports to ${r.reportsTo ?? 'the Owner'})`)
          .join('\n');
        const proposals = this.proposals.length
          ? `\n\nProposed hires (not hired yet):\n${this.proposals.map((p) => `- ${p.id}: ${p.name}, ${p.roleId} (${p.level})`).join('\n')}`
          : '';
        return { ok: true, text: `Team:\n${this.roster()}${proposals}\n\nRoles in the company (role id: title):\n${roles}` };
      }

      case 'get_project': {
        const p = this.project;
        if (!p) return { ok: true, text: 'There is no project yet.' };
        const approved = [...p.prd].reverse().find((v) => v.status === 'approved');
        const latest = p.prd.at(-1);
        const shown = approved ?? latest;
        const prdText = shown
          ? `PRD v${shown.version} “${shown.title}” (${shown.status.replace('_', ' ')})${shown.ownerComment ? `\nOwner’s note: ${shown.ownerComment}` : ''}\n\n${shown.markdown}`
          : 'No PRD yet.';
        return {
          ok: true,
          text: `Project: ${p.title}\nBrief: ${p.brief}\nPhase: ${p.phase}\nProject folder: ${p.workspaceDir}\nTasks: ${this.taskSummary()}\n\n${prdText}`,
        };
      }

      case 'list_tasks':
        return { ok: true, text: this.tasks.length ? this.tasks.map((t) => this.taskLine(t)).join('\n') : 'No tasks yet.' };

      case 'submit_prd': {
        if (role !== 'ceo') return { ok: false, text: 'Only the CEO submits the PRD.' };
        const p = this.project;
        if (!p) return { ok: false, text: 'There is no project yet.' };
        const title = str('title', 120);
        const markdown = typeof input.markdown === 'string' ? input.markdown.trim() : '';
        if (!title || markdown.length < 40) return { ok: false, text: 'Give the PRD a title and full Markdown content.' };
        if (markdown.length > 40_000) return { ok: false, text: 'The PRD is too long (max 40,000 characters).' };
        for (const v of p.prd) if (v.status === 'pending') v.status = 'superseded';
        const version = p.prd.length + 1;
        p.prd.push({
          version,
          title,
          markdown,
          submittedBy: employeeId,
          submittedAt: now(),
          status: 'pending',
          ownerComment: null,
          decidedAt: null,
        });
        this.setPhase('prd_review');
        this.opts.bus.emit({ type: 'prd.submitted', version, title, by: employeeId });
        this.post('system', OWNER_ID, `PRD v${version} “${title}” is ready for your approval. Open Project on the dashboard, or run /olympus:prd in Claude Code.`);
        this.changed();
        return {
          ok: true,
          text: `Submitted PRD v${version}. Nobody can be hired and no tasks can start until the Owner approves it. Tell the Owner it's ready, then end your turn.`,
        };
      }

      case 'propose_team':
        return this.proposeTeam(me, input.hires);

      case 'hire_team': {
        if (role !== 'hr') return { ok: false, text: 'Only HR hires.' };
        if (!this.prdApproved()) {
          return { ok: false, text: 'You can hire only after the Owner approves the PRD. Wait for the CEO to tell you it was approved.' };
        }
        const wanted = Array.isArray(input.proposal_ids) ? input.proposal_ids.map(String) : null;
        const picked = this.proposals.filter((p) => !wanted || wanted.includes(p.id));
        if (picked.length === 0) return { ok: false, text: 'No matching proposed hires. Call list_team to see the proposal ids.' };
        const hired = picked.map((p) => this.hire(p.roleId, p.name, p.level, employeeId));
        this.proposals = this.proposals.filter((p) => !picked.includes(p));
        this.opts.bus.emit({ type: 'team.proposed', employeeId, count: this.proposals.length });
        this.changed();
        return {
          ok: true,
          text: `Hired ${hired.length}:\n${hired
            .map((m) => `- ${m.data.name}, ${m.data.title}: id "${m.data.id}", reports to ${this.nameOf(this.managerOf(m.data))}`)
            .join('\n')}`,
        };
      }

      case 'create_task': {
        if (!TASK_LEAD_ROLES.has(role)) return { ok: false, text: 'Only the CEO, CTO, Tech Lead or Architect create tasks.' };
        if (!this.project) return { ok: false, text: 'There is no project yet.' };
        if (!this.prdApproved()) return { ok: false, text: 'Tasks can start only after the Owner approves the PRD.' };
        const title = str('title', 120);
        const description = str('description', 4000);
        const assigneeId = str('assignee', 64);
        if (!title) return { ok: false, text: 'Give the task a title.' };
        const assignee = this.members.get(assigneeId);
        if (!assignee || assignee.data.status === 'fired') {
          return { ok: false, text: `No active employee with id "${assigneeId}". Call list_team to see ids.` };
        }
        const task: Task = {
          id: `T-${this.nextTaskId++}`,
          title,
          description,
          assigneeId,
          status: 'todo',
          createdBy: employeeId,
          createdAt: now(),
          updatedAt: now(),
          notes: [],
        };
        this.tasks.push(task);
        if (this.project.phase === 'approved') this.setPhase('building');
        this.opts.bus.emit({ type: 'task.created', taskId: task.id, title, assigneeId, by: employeeId });
        if (assigneeId !== employeeId) {
          this.deliver(
            'system',
            assigneeId,
            `New task ${task.id} from ${me.data.name}: ${title}\n${description}\nMove it to in_progress when you start and to done when it is finished (or blocked, with the reason), using update_task.`,
            'task',
            employeeId,
          );
        }
        this.changed();
        return { ok: true, text: `Created ${task.id} for ${assignee.data.name}.` };
      }

      case 'update_task': {
        const task = this.tasks.find((t) => t.id === str('task_id', 16));
        if (!task) return { ok: false, text: `No task "${str('task_id', 16)}". Call list_tasks.` };
        const isLead = TASK_LEAD_ROLES.has(role);
        if (task.assigneeId !== employeeId && !isLead) return { ok: false, text: `${task.id} is not your task.` };
        const status = str('status', 16) as TaskStatus;
        if (!TASK_STATUSES.includes(status)) return { ok: false, text: `Status must be one of ${TASK_STATUSES.join(', ')}.` };
        const newAssignee = str('assignee', 64);
        if (newAssignee) {
          if (!isLead) return { ok: false, text: 'Only a lead can reassign a task.' };
          const target = this.members.get(newAssignee);
          if (!target || target.data.status === 'fired') return { ok: false, text: `No active employee with id "${newAssignee}".` };
          task.assigneeId = newAssignee;
          if (newAssignee !== employeeId) {
            this.deliver('system', newAssignee, `${me.data.name} assigned you ${task.id}: ${task.title}\n${task.description}`, 'task', employeeId);
          }
        }
        const note = str('note', 1000) || null;
        const wasDone = task.status === 'done';
        task.status = status;
        task.updatedAt = now();
        task.notes.push({ ts: now(), by: employeeId, text: note ?? `moved to ${status}`, status });
        if (status === 'done' && !wasDone) this.metrics.tasksDone.push(now());
        this.opts.bus.emit({ type: 'task.updated', taskId: task.id, status, by: employeeId, note });

        const allDone = this.tasks.length > 0 && this.tasks.every((t) => t.status === 'done');
        if (allDone && this.project) this.setPhase('done');
        else if (this.project?.phase === 'done') this.setPhase('building');
        // The work lead hears about finished, blocked and review-ready work (not every small step).
        const lead = this.workLead();
        const worthTelling = status === 'done' || status === 'blocked' || status === 'review' || Boolean(newAssignee);
        if (lead && lead.data.id !== employeeId && worthTelling) {
          this.deliver(
            'system',
            lead.data.id,
            `${task.id} “${task.title}” is now ${status} (by ${me.data.name})${note ? `: ${note}` : '.'}\nBoard: ${this.taskSummary()}.${allDone ? '\nAll tasks are done. Check the work, then report to the CEO (or to the Owner if you are the CEO).' : ''}`,
            'task_update',
            employeeId,
          );
        }
        this.changed();
        return { ok: true, text: `${task.id} is now ${status}. Board: ${this.taskSummary()}.` };
      }

      default:
        return { ok: false, text: `Unknown company tool "${tool}".` };
    }
  }

  private proposeTeam(me: Member, rawHires: unknown): ToolResult {
    if (me.data.roleId !== 'hr') return { ok: false, text: 'Only HR can propose hires.' };
    const hires = Array.isArray(rawHires) ? (rawHires as Array<Record<string, unknown>>) : [];
    if (hires.length === 0) return { ok: false, text: 'Propose at least one hire.' };
    if (hires.length > MAX_PROPOSED_HIRES) return { ok: false, text: `Propose at most ${MAX_PROPOSED_HIRES} hires.` };
    const validRoles = ORG_ROLES.filter((r) => !FOUNDING_ROLE_IDS.has(r.id)).map((r) => r.id);
    const proposals: ProposedHire[] = [];
    for (const [i, hire] of hires.entries()) {
      const role = typeof hire?.role === 'string' ? roleById(hire.role) : undefined;
      if (!role || FOUNDING_ROLE_IDS.has(role.id)) {
        return { ok: false, text: `Hire ${i + 1}: unknown role "${String(hire?.role)}". Valid roles: ${validRoles.join(', ')}.` };
      }
      const level = hire.level as Level;
      if (!LEVELS.includes(level)) return { ok: false, text: `Hire ${i + 1}: level must be one of ${LEVELS.join(', ')}.` };
      const name = String(hire.name ?? '').trim();
      if (name.length < 2 || name.length > 60) return { ok: false, text: `Hire ${i + 1}: give a name (2–60 characters).` };
      proposals.push({
        id: `p${i + 1}`,
        roleId: role.id,
        name,
        level,
        model: modelFor(role, level),
        reason: String(hire.reason ?? '').trim().slice(0, 200),
        proposedBy: me.data.id,
        ts: now(),
      });
    }
    this.proposals = proposals;
    this.opts.bus.emit({ type: 'team.proposed', employeeId: me.data.id, count: proposals.length });
    this.changed();
    return {
      ok: true,
      text: `Recorded ${proposals.length} proposed hires (ids ${proposals.map((p) => p.id).join(', ')}). The Owner sees them on the dashboard. Nobody is hired until the Owner approves the PRD; then hire them with hire_team.`,
    };
  }

  // ───────────────────────────── people ─────────────────────────────

  private hireFounders(): void {
    for (const founder of FOUNDING_TEAM) this.hire(founder.roleId, founder.name, null, 'founding', founder.id);
  }

  private hire(roleId: string, name: string, level: Level | null, by: Employee['hiredBy'], forcedId?: string): Member {
    const role = roleById(roleId)!;
    const id = forcedId ?? this.freshId(roleId);
    const member: Member = {
      data: {
        id,
        name,
        roleId,
        title: role.title,
        level,
        managerId: null,
        model: modelFor(role, level ?? 'sde2'),
        effort: effortFor(roleId),
        status: 'idle',
        activity: 'Waiting for work',
        activations: 0,
        lastDurationMs: null,
        hiredAt: now(),
        hiredBy: by,
      },
      inbox: [],
      controller: null,
      projectActivations: 0,
    };
    this.members.set(id, member);
    this.opts.bus.emit({ type: 'employee.hired', employeeId: id, by });
    if (by !== 'founding') {
      const manager = this.nameOf(this.managerOf(member.data));
      this.post('system', '#general', `Welcome ${name}, our new ${role.title}${level ? ` (${level.toUpperCase()})` : ''}. Reports to ${manager}.`);
    }
    return member;
  }

  private freshId(roleId: string): string {
    if (!this.members.has(roleId)) return roleId;
    for (let n = 2; ; n++) if (!this.members.has(`${roleId}-${n}`)) return `${roleId}-${n}`;
  }

  private freshName(): string {
    const used = new Set([...this.members.values()].map((m) => m.data.name));
    return PERSONA_NAMES.find((n) => !used.has(n)) ?? `Employee ${this.members.size + 1}`;
  }

  private activeInRole(roleId: string): Member | undefined {
    return [...this.members.values()]
      .filter((m) => m.data.roleId === roleId && m.data.status !== 'fired')
      .sort((a, b) => a.data.hiredAt.localeCompare(b.data.hiredAt))[0];
  }

  /** The nearest role up the org structure that has someone in it. null = the Owner. */
  private managerOf(employee: Employee): EmployeeId | null {
    let parent = roleById(employee.roleId)?.reportsTo ?? null;
    while (parent) {
      const boss = this.activeInRole(parent);
      if (boss && boss.data.id !== employee.id) return boss.data.id;
      parent = roleById(parent)?.reportsTo ?? null;
    }
    return null;
  }

  /** Who monitors the task board: the Tech Lead, else the CTO, else the CEO. */
  private workLead(): Member | undefined {
    for (const roleId of WORK_LEAD_ROLES) {
      const member = this.activeInRole(roleId);
      if (member) return member;
    }
    return undefined;
  }

  private roster(): string {
    return [...this.members.values()]
      .filter((m) => m.data.status !== 'fired')
      .map((m) => `- ${m.data.name}, ${m.data.title}: id "${m.data.id}", reports to ${this.nameOf(this.managerOf(m.data))}`)
      .join('\n');
  }

  private nameOf(id: EmployeeId | null): string {
    if (!id) return 'the Owner';
    return this.members.get(id)?.data.name ?? id;
  }

  // ───────────────────────────── messages ─────────────────────────────

  private deliver(from: 'owner' | 'system', to: EmployeeId, text: string, kind: InboxKind, causedBy?: EmployeeId): void {
    const result = this.post(from, to, text, kind, causedBy);
    if (!result.ok) throw new CompanyError(400, result.text);
  }

  /** Posts a message. Checks every rule here, so agents can't skip them. */
  private post(from: ChatMessage['from'], to: string, rawText: string, kind: InboxKind = 'dm', causedBy?: EmployeeId): ToolResult {
    const text = rawText.trim();
    if (!text) return { ok: false, text: 'The message is empty.' };
    if (text.length > 6000) return { ok: false, text: 'The message is too long (max 6000 characters).' };

    let recipient: Member | null = null;
    let label: string;
    if (to === OWNER_ID) {
      const sender = from === 'system' || from === OWNER_ID ? null : this.members.get(from);
      if (sender && sender.data.roleId !== 'ceo') {
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

    const message: ChatMessage = { id: this.nextMessageId++, ts: now(), from, to, text };
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) this.messages = this.messages.slice(-MAX_MESSAGES);
    this.metrics.messages.push(message.ts);
    this.opts.bus.emit({ type: 'message.posted', message });

    if (recipient) {
      recipient.inbox.push({ from, fromLabel: this.labelFor(from), kind, text, ts: message.ts, ...(causedBy ? { causedBy } : {}) });
      if (!recipient.controller) this.setStatus(recipient, 'queued', 'New message waiting');
      this.scheduleSoon();
    }
    this.changed();
    return { ok: true, text: `Delivered to ${label}.` };
  }

  private labelFor(from: ChatMessage['from']): string {
    if (from === OWNER_ID) return 'the Owner';
    if (from === 'system') return 'the company system';
    const member = this.members.get(from);
    return member ? `${member.data.name} (${member.data.title}, id "${member.data.id}")` : from;
  }

  // ───────────────────────────── scheduling ─────────────────────────────

  private runtime(): AgentRuntime | null {
    return this.settings.mode === 'claude-code' ? this.opts.runtimes.host : this.opts.runtimes.simulated;
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
    const runtime = this.runtime();
    if (!runtime) return;
    const { maxConcurrency, maxActivationsPerEmployee, maxActivationsPerProject } = this.settings;
    for (const member of this.members.values()) {
      if (member.data.status === 'fired' || member.controller || member.inbox.length === 0) continue;
      if (this.waitingOnSender(member)) continue;
      if (this.runningCount() >= maxConcurrency) break;
      if (this.activationsThisProject >= maxActivationsPerProject) {
        if (!this.limitNoticeSent) {
          this.limitNoticeSent = true;
          this.notice('warning', `This project reached its limit of ${maxActivationsPerProject} agent runs. Raise it in Settings to continue.`);
        }
        this.setStatus(member, 'queued', 'Paused: project agent-run limit reached');
        continue;
      }
      if (member.projectActivations >= maxActivationsPerEmployee) {
        if (!this.limitNoticed.has(member.data.id)) {
          this.limitNoticed.add(member.data.id);
          this.notice('warning', `${member.data.name} reached the limit of ${maxActivationsPerEmployee} agent runs for this project. Raise it in Settings to continue.`);
        }
        this.setStatus(member, 'queued', 'Paused: personal agent-run limit reached');
        continue;
      }
      void this.activate(member, runtime);
    }
    this.changed();
  }

  private async activate(member: Member, runtime: AgentRuntime): Promise<void> {
    const generation = this.generation;
    const employeeId = member.data.id;
    const inbox = member.inbox.splice(0);
    const controller = new AbortController();
    const activationId = `a_${randomBytes(6).toString('hex')}`;
    member.controller = controller;
    member.projectActivations++;
    member.data.activations++;
    this.activationsThisProject++;
    this.metrics.activations.push(now());

    const trigger = describeTrigger(inbox);
    this.setStatus(
      member,
      'working',
      runtime.mode === 'claude-code' ? `Waiting for Claude Code to pick up ${trigger}` : `Reading ${trigger}`,
    );
    this.opts.bus.emit({ type: 'activation.started', employeeId, activationId, trigger });

    const firstName = member.data.name.split(' ')[0] ?? member.data.name;
    const myTasks = this.tasks.filter((t) => t.assigneeId === employeeId && t.status !== 'done');
    let result: ActivationResult;
    try {
      result = await runtime.run({
        activationId,
        employee: { ...member.data, managerId: this.managerOf(member.data) },
        agentType: agentTypeFor(member.data.roleId),
        description: `${firstName} (${member.data.title}): ${trigger}`,
        prompt: activationPrompt({
          companyName: this.opts.companyName,
          name: member.data.name,
          title: member.data.title,
          employeeId,
          activationId,
          roster: this.roster(),
          project: this.project,
          isBuilder: BUILDER_ROLES.has(member.data.roleId),
          myTasks,
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
      member.projectActivations--;
      this.activationsThisProject--;
    }
    this.opts.bus.emit({
      type: 'activation.completed',
      employeeId,
      activationId,
      outcome: result.outcome,
      durationMs: result.durationMs,
      ...(result.detail ? { detail: result.detail } : {}),
    });
    if (result.outcome === 'error') this.notice('error', `${member.data.name}'s run failed: ${result.detail ?? 'unknown error'}`);
    if (member.data.status !== 'fired') {
      const activity = result.outcome === 'success' ? 'Done, waiting for messages' : `Stopped (${result.outcome})`;
      this.setStatus(member, member.inbox.length > 0 ? 'queued' : 'idle', activity);
    }
    this.scheduleSoon();
  }

  private toolsFor(employeeId: EmployeeId, generation: number): CompanyTools {
    return {
      call: (tool, input) => {
        if (generation !== this.generation) return { ok: false, text: 'This activation has ended. Stop now.' };
        return this.callTool(employeeId, tool, input ?? {});
      },
    };
  }

  /**
   * Messages from someone who is still mid-turn wait until that turn ends, so the recipient gets
   * everything in one run (all the tasks a lead creates, all the updates from one engineer).
   */
  private waitingOnSender(member: Member): boolean {
    return member.inbox.some((item) => {
      const source = item.causedBy ?? item.from;
      if (source === OWNER_ID || source === 'system' || source === member.data.id) return false;
      return Boolean(this.members.get(source)?.controller);
    });
  }

  /** Someone is working, or has unread work they are allowed to start. */
  private isBusy(): boolean {
    return [...this.members.values()].some(
      (m) => m.controller !== null || (m.data.status !== 'fired' && m.inbox.length > 0 && !this.limitBlocked(m)),
    );
  }

  private limitBlocked(member: Member): boolean {
    return (
      this.activationsThisProject >= this.settings.maxActivationsPerProject ||
      member.projectActivations >= this.settings.maxActivationsPerEmployee
    );
  }

  private pausedByLimits(): Member[] {
    return [...this.members.values()].filter((m) => m.data.status !== 'fired' && m.inbox.length > 0 && this.limitBlocked(m));
  }

  private runningCount(): number {
    let count = 0;
    for (const member of this.members.values()) if (member.controller) count++;
    return count;
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private prdApproved(): boolean {
    return Boolean(this.project?.prd.some((v) => v.status === 'approved'));
  }

  private setPhase(phase: ProjectPhase): void {
    if (!this.project || this.project.phase === phase) return;
    this.project.phase = phase;
    this.opts.bus.emit({ type: 'project.phase_changed', phase });
  }

  private taskSummary(): string {
    const done = this.tasks.filter((t) => t.status === 'done').length;
    const blocked = this.tasks.filter((t) => t.status === 'blocked').length;
    return `${done}/${this.tasks.length} done${blocked ? `, ${blocked} blocked` : ''}`;
  }

  private taskLine(t: Task): string {
    const who = t.assigneeId ? `${this.nameOf(t.assigneeId)} (${t.assigneeId})` : 'unassigned';
    const last = t.notes.at(-1)?.text;
    return `${t.id} [${t.status}] ${t.title} · ${who}${last ? ` · last note: ${last}` : ''}`;
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

  // ───────────────────────────── persistence ─────────────────────────────

  private changed(): void {
    if (!this.opts.persist || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 300);
    this.saveTimer.unref();
  }

  private saveNow(): void {
    if (!this.opts.persist) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.opts.persist.save({
      version: 1,
      members: [...this.members.values()].map((m) => ({ data: m.data, inbox: m.inbox, projectActivations: m.projectActivations })),
      messages: this.messages,
      proposals: this.proposals,
      project: this.project,
      tasks: this.tasks,
      settings: this.settings,
      metrics: this.metrics,
      counters: { message: this.nextMessageId, task: this.nextTaskId },
      activationsThisProject: this.activationsThisProject,
    });
  }

  private restore(saved: SavedCompany): void {
    for (const m of saved.members) {
      const status: EmployeeStatus = m.data.status === 'fired' ? 'fired' : m.inbox.length > 0 ? 'queued' : 'idle';
      this.members.set(m.data.id, {
        data: { ...m.data, status, activity: status === 'queued' ? 'New message waiting' : m.data.activity },
        inbox: m.inbox,
        controller: null,
        projectActivations: m.projectActivations,
      });
    }
    this.messages = saved.messages;
    this.proposals = saved.proposals;
    this.project = saved.project;
    this.tasks = saved.tasks;
    this.settings = { ...this.settings, ...saved.settings };
    this.metrics = saved.metrics ?? emptyMetrics();
    this.nextMessageId = saved.counters.message;
    this.nextTaskId = saved.counters.task;
    this.activationsThisProject = saved.activationsThisProject;
    if (this.members.size === 0) this.hireFounders();
  }
}

function emptyMetrics(): Metrics {
  return { activations: [], tasksDone: [], messages: [] };
}

function now(): string {
  return new Date().toISOString();
}

/** Shown on the dashboard. The model and effort that run come from each plugin agent's frontmatter. */
function effortFor(roleId: string): Effort {
  if (roleId === 'hr' || roleId === 'writer') return 'low';
  return 'medium';
}

function describeTrigger(inbox: InboxItem[]): string {
  const senders = [...new Set(inbox.map((item) => item.fromLabel.split(' (')[0]))];
  return `${inbox.length} message${inbox.length === 1 ? '' : 's'} from ${senders.join(', ')}`;
}

function titleFromBrief(brief: string): string {
  const firstLine = brief.split('\n')[0]?.trim() ?? brief;
  const clean = firstLine.replace(/^(please\s+)?(build|make|create)\s+(me\s+)?(an?\s+)?/i, '').trim();
  const title = clean.length > 0 ? clean : firstLine;
  const short = title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
}
