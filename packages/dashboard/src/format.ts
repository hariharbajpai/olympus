import type { CompanyEvent, CompanyState, Employee, Level, OrgRole } from '@olympus/shared';

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

export const LEVEL_LABEL: Record<Level, string> = {
  sde1: 'SDE-I',
  sde2: 'SDE-II',
  senior: 'Senior',
  mts: 'MTS',
};

export function nameOf(state: CompanyState | null, id: string): string {
  if (id === 'owner') return 'Owner';
  if (id === 'system') return 'System';
  if (id.startsWith('#')) return id;
  const person = state?.employees.find((e) => e.id === id);
  return person ? (person.name.split(' ')[0] ?? person.name) : id;
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
      return 'Fired';
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
  text: string;
}

/** Turns an event into one readable feed line, or null for events the feed skips. */
export function feedLine(event: CompanyEvent, state: CompanyState | null): FeedLine | null {
  const who = (id: string) => nameOf(state, id);
  const base = { id: event.id, ts: event.ts };
  switch (event.type) {
    case 'company.reset':
      return { ...base, tone: 'neutral', who: null, text: 'Company reset: fresh founding team' };
    case 'demo.started':
      return {
        ...base,
        tone: 'start',
        who: 'Owner',
        text: `started a ${event.mode === 'claude-code' ? 'Claude Code' : 'simulated'} run: “${event.brief.length > 90 ? `${event.brief.slice(0, 89)}…` : event.brief}”`,
      };
    case 'demo.finished':
      return { ...base, tone: 'done', who: null, text: `Run finished · ${event.activations} agent runs` };
    case 'host.claimed':
      return {
        ...base,
        tone: 'neutral',
        who: 'Claude Code',
        text: `picked up ${event.activationIds.length} activation${event.activationIds.length === 1 ? '' : 's'}`,
      };
    case 'activation.started':
      return { ...base, tone: 'start', who: who(event.employeeId), text: `has work (${event.trigger})` };
    case 'activation.completed':
      if (event.outcome === 'success') {
        return { ...base, tone: 'done', who: who(event.employeeId), text: `finished · ${duration(event.durationMs)}` };
      }
      if (event.outcome === 'aborted') {
        return { ...base, tone: 'warn', who: who(event.employeeId), text: 'was stopped mid-task' };
      }
      return { ...base, tone: 'danger', who: who(event.employeeId), text: `failed${event.detail ? `: ${event.detail}` : ''}` };
    case 'agent.action':
      return { ...base, tone: 'action', who: who(event.employeeId), text: event.summary };
    case 'agent.note':
      return { ...base, tone: 'note', who: who(event.employeeId), text: event.text };
    case 'team.proposed':
      return { ...base, tone: 'start', who: who(event.employeeId), text: `proposed ${event.count} hires (see the org chart)` };
    case 'employee.fired':
      return { ...base, tone: 'danger', who: who(event.employeeId), text: `was fired. Reason: ${event.reason}` };
    case 'system.notice':
      return {
        ...base,
        tone: event.level === 'info' ? 'neutral' : event.level === 'warning' ? 'warn' : 'danger',
        who: null,
        text: event.text,
      };
    default:
      return null;
  }
}
