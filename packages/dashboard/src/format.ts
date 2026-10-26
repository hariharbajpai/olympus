import type { CompanyEvent, CompanyState, Employee, Level, OrgRole, ProjectPhase, TaskStatus } from '@olympus/shared';

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function shortClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function modelLabel(model: string): string {
  const match = /^claude-(\w+)-(\d+)-(\d+)$/.exec(model);
  if (!match) return model;
  const [, family = '', major, minor] = match;
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}

export const LEVEL_LABEL: Record<Level, string> = { sde1: 'SDE-I', sde2: 'SDE-II', senior: 'Senior', mts: 'MTS' };

export const PHASES: Array<{ id: ProjectPhase; label: string }> = [
  { id: 'planning', label: 'Planning' },
  { id: 'prd_review', label: 'PRD review' },
  { id: 'approved', label: 'Hiring' },
  { id: 'building', label: 'Building' },
  { id: 'done', label: 'Done' },
];

export const TASK_COLUMNS: Array<{ id: TaskStatus; label: string }> = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Done' },
];

export function nameOf(state: CompanyState | null, id: string): string {
  if (id === 'owner') return 'Owner';
  if (id === 'system') return 'System';
  if (id.startsWith('#')) return id;
  const person = state?.employees.find((e) => e.id === id);
  return person ? (person.name.split(' ')[0] ?? person.name) : id;
}

export function firstName(e: Employee): string {
  return e.name.split(' ')[0] ?? e.name;
}

const DEPARTMENT_HUE: Record<string, string> = {
  Leadership: 'var(--violet)',
  People: 'var(--teal)',
  Engineering: 'var(--blue)',
  Design: 'var(--pink)',
  Docs: 'var(--amber)',
  Quality: 'var(--green)',
  Platform: 'var(--orange)',
};

export function hueFor(role: OrgRole | undefined): string {
  return (role && DEPARTMENT_HUE[role.department]) ?? 'var(--accent)';
}

export function statusLabel(employee: Employee): string {
  switch (employee.status) {
    case 'working':
      return 'Working';
    case 'queued':
      return 'Queued';
    case 'fired':
      return 'Left';
    default:
      return 'Idle';
  }
}

export type FeedTone = 'neutral' | 'start' | 'done' | 'action' | 'note' | 'warn' | 'danger';

export interface FeedLine {
  id: number;
  ts: string;
  tone: FeedTone;
  who: string | null;
  whoId: string | null;
  text: string;
}

/** Turns an event into one readable feed line, or null for events the feed skips. */
export function feedLine(event: CompanyEvent, state: CompanyState | null): FeedLine | null {
  const who = (id: string) => nameOf(state, id);
  const base = { id: event.id, ts: event.ts };
  switch (event.type) {
    case 'company.reset':
      return { ...base, tone: 'neutral', who: null, whoId: null, text: 'Company reset: back to the founding CEO and HR' };
    case 'project.started':
      return { ...base, tone: 'start', who: 'Owner', whoId: 'owner', text: `started the project “${event.title}”` };
    case 'project.phase_changed':
      return { ...base, tone: 'neutral', who: null, whoId: null, text: `Project phase: ${PHASES.find((p) => p.id === event.phase)?.label ?? event.phase}` };
    case 'prd.submitted':
      return { ...base, tone: 'start', who: who(event.by), whoId: event.by, text: `submitted PRD v${event.version} “${event.title}” for approval` };
    case 'prd.decided':
      return {
        ...base,
        tone: event.decision === 'approved' ? 'done' : 'warn',
        who: 'Owner',
        whoId: 'owner',
        text: event.decision === 'approved' ? `approved PRD v${event.version}` : `asked for changes to PRD v${event.version}: ${event.comment ?? ''}`,
      };
    case 'employee.hired': {
      const e = state?.employees.find((x) => x.id === event.employeeId);
      const by = event.by === 'owner' ? 'the Owner' : event.by === 'founding' ? 'founding team' : who(event.by);
      return { ...base, tone: 'done', who: e?.name ?? event.employeeId, whoId: event.employeeId, text: `joined as ${e?.title ?? 'employee'} (hired by ${by})` };
    }
    case 'employee.fired':
      return { ...base, tone: 'danger', who: who(event.employeeId), whoId: event.employeeId, text: `was fired. Reason: ${event.reason}` };
    case 'host.claimed':
      return { ...base, tone: 'neutral', who: 'Claude Code', whoId: null, text: `picked up ${event.activationIds.length} activation${event.activationIds.length === 1 ? '' : 's'}` };
    case 'activation.started':
      return { ...base, tone: 'start', who: who(event.employeeId), whoId: event.employeeId, text: `has work (${event.trigger})` };
    case 'activation.completed':
      if (event.outcome === 'success') return { ...base, tone: 'done', who: who(event.employeeId), whoId: event.employeeId, text: `finished · ${duration(event.durationMs)}` };
      if (event.outcome === 'aborted') return { ...base, tone: 'warn', who: who(event.employeeId), whoId: event.employeeId, text: 'was stopped mid-task' };
      return { ...base, tone: 'danger', who: who(event.employeeId), whoId: event.employeeId, text: `failed${event.detail ? `: ${event.detail}` : ''}` };
    case 'agent.action':
      return { ...base, tone: 'action', who: who(event.employeeId), whoId: event.employeeId, text: event.summary };
    case 'agent.note':
      return { ...base, tone: 'note', who: who(event.employeeId), whoId: event.employeeId, text: event.text };
    case 'team.proposed':
      return event.count > 0
        ? { ...base, tone: 'start', who: who(event.employeeId), whoId: event.employeeId, text: `proposed ${event.count} hires` }
        : null;
    case 'task.created':
      return { ...base, tone: 'start', who: who(event.by), whoId: event.by, text: `created ${event.taskId} “${event.title}”${event.assigneeId ? ` for ${who(event.assigneeId)}` : ''}` };
    case 'task.updated':
      return {
        ...base,
        tone: event.status === 'done' ? 'done' : event.status === 'blocked' ? 'danger' : 'action',
        who: event.by === 'system' ? 'System' : who(event.by),
        whoId: event.by === 'system' ? null : event.by,
        text: `${event.taskId} → ${TASK_COLUMNS.find((c) => c.id === event.status)?.label ?? event.status}${event.note ? `: ${event.note}` : ''}`,
      };
    case 'settings.updated':
      return { ...base, tone: 'neutral', who: 'Owner', whoId: 'owner', text: `changed settings (mode: ${event.settings.mode === 'claude-code' ? 'Claude Code' : 'simulated'})` };
    case 'system.notice':
      return { ...base, tone: event.level === 'info' ? 'neutral' : event.level === 'warning' ? 'warn' : 'danger', who: null, whoId: null, text: event.text };
    default:
      return null;
  }
}
