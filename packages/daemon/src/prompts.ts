// The daemon writes only the per-activation prompt. Each role's standing instructions (handbook
// plus role charter) live in the plugin's agent files: plugin/agents/<role>.md.

import type { InboxItem } from './runtime/types.js';

export const OWNER_ID = 'owner';
export const CHANNELS = ['#general'] as const;

export interface FoundingMember {
  id: 'ceo' | 'hr';
  name: string;
  roleId: 'ceo' | 'hr';
  managerId: 'ceo' | null;
}

export const FOUNDING_TEAM: FoundingMember[] = [
  { id: 'ceo', name: 'Aarav Kapoor', roleId: 'ceo', managerId: null },
  { id: 'hr', name: 'Meera Iyer', roleId: 'hr', managerId: 'ceo' },
];

/** Plugin subagent that runs a role: plugin/agents/<roleId>.md, namespaced by the plugin name. */
export function agentTypeFor(roleId: string): string {
  return `olympus:${roleId}`;
}

export function hrOnboardingMessage(companyName: string): string {
  return `Welcome to ${companyName}. The company starts today. Introduce yourself in #general as your role instructions describe, then wait for requests from the CEO.`;
}

export function activationPrompt(opts: {
  companyName: string;
  name: string;
  title: string;
  employeeId: string;
  activationId: string;
  roster: string;
  inbox: InboxItem[];
}): string {
  const messages = opts.inbox
    .map((item, i) => `--- Message ${i + 1} · from ${item.fromLabel} · ${item.ts} ---\n${item.text}`)
    .join('\n\n');
  return `You are ${opts.name}, ${opts.title} at ${opts.companyName} (employee id "${opts.employeeId}").

Your activation id is ${opts.activationId}. Pass it as the \`activation\` argument in every company tool call.

## Team
${opts.roster}

## New messages (${opts.inbox.length})
${messages}

Act on these messages with the company tools. If a tool says you no longer work here or that the activation has ended, stop at once. When you are done, end with a report of one to three lines saying what you did.`;
}
