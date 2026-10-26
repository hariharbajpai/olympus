// The daemon writes only the per-activation prompt. Each role's standing instructions (handbook
// plus role charter) live in the plugin's agent files: plugin/agents/<role>.md.

import type { Project, Task } from '@olympus/shared';
import type { InboxItem } from './runtime/types.js';

export const OWNER_ID = 'owner';
export const CHANNELS = ['#general'] as const;

export interface FoundingMember {
  id: 'ceo' | 'hr';
  name: string;
  roleId: 'ceo' | 'hr';
}

export const FOUNDING_TEAM: FoundingMember[] = [
  { id: 'ceo', name: 'Aarav Kapoor', roleId: 'ceo' },
  { id: 'hr', name: 'Meera Iyer', roleId: 'hr' },
];

/** Plugin subagent that runs a role: plugin/agents/<roleId>.md, namespaced by the plugin name. */
export function agentTypeFor(roleId: string): string {
  return `olympus:${roleId}`;
}

const PHASE_LABEL: Record<Project['phase'], string> = {
  planning: 'Planning (the CEO is preparing the PRD)',
  prd_review: 'PRD waiting for the Owner’s approval',
  approved: 'PRD approved: hiring and planning',
  building: 'Building',
  done: 'All tasks done',
};

function projectSection(project: Project | null, isBuilder: boolean, myTasks: Task[]): string {
  if (!project) return '## Project\nNo project yet. The Owner starts one with /olympus:brief.';
  const latest = project.prd.at(-1);
  const prd = latest
    ? `PRD v${latest.version} "${latest.title}": ${latest.status.replace('_', ' ')}. Read it with get_project.`
    : 'No PRD yet.';
  const lines = [
    '## Project',
    `Brief from the Owner: ${project.brief}`,
    `Phase: ${PHASE_LABEL[project.phase]}`,
    prd,
  ];
  if (isBuilder) {
    lines.push(
      `Project folder: ${project.workspaceDir}`,
      'Create and edit files only inside that folder (use absolute paths). Never touch files anywhere else.',
    );
  }
  if (myTasks.length > 0) {
    lines.push(
      '',
      '## Your open tasks',
      ...myTasks.map((t) => `- ${t.id} [${t.status}] ${t.title}`),
    );
  }
  return lines.join('\n');
}

export function activationPrompt(opts: {
  companyName: string;
  name: string;
  title: string;
  employeeId: string;
  activationId: string;
  roster: string;
  project: Project | null;
  isBuilder: boolean;
  myTasks: Task[];
  inbox: InboxItem[];
}): string {
  const messages = opts.inbox
    .map((item, i) => `--- Message ${i + 1} · from ${item.fromLabel} · ${item.ts} ---\n${item.text}`)
    .join('\n\n');
  return `You are ${opts.name}, ${opts.title} at ${opts.companyName} (employee id "${opts.employeeId}").

Your activation id is ${opts.activationId}. Pass it as the \`activation\` argument in every company tool call.

## Team (who reports to whom)
${opts.roster}

${projectSection(opts.project, opts.isBuilder, opts.myTasks)}

## New messages (${opts.inbox.length})
${messages}

Act on these messages with the company tools. If a tool says you no longer work here or that the activation has ended, stop at once. When you are done, end with a report of one to three lines saying what you did.`;
}
