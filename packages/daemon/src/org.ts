import type { Level, OrgRole } from '@olympus/shared';

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';

/** The company's org structure (PRD §6). `reportsTo: null` means the role reports to the Owner. */
export const ORG_ROLES: OrgRole[] = [
  { id: 'ceo', title: 'Chief Executive Officer', department: 'Leadership', reportsTo: null, summary: 'Turns Owner requests into PRDs and runs the company', defaultModel: OPUS },
  { id: 'hr', title: 'Head of HR', department: 'People', reportsTo: 'ceo', summary: 'Staffing proposals, hiring and offboarding', defaultModel: SONNET },
  { id: 'cto', title: 'Chief Technology Officer', department: 'Engineering', reportsTo: 'ceo', summary: 'Tech design, task breakdown, staffing plan', defaultModel: OPUS },
  { id: 'designer', title: 'Product Designer (UI/UX)', department: 'Design', reportsTo: 'ceo', summary: 'Screens, design system, UX copy', defaultModel: SONNET },
  { id: 'writer', title: 'Technical Writer', department: 'Docs', reportsTo: 'ceo', summary: 'README, user guide, API docs', defaultModel: HAIKU },
  { id: 'tech-lead', title: 'Engineering Manager / Tech Lead', department: 'Engineering', reportsTo: 'cto', summary: 'Assigns tasks, routes reviews, unblocks engineers', defaultModel: SONNET },
  { id: 'architect', title: 'Software Architect (MTS)', department: 'Engineering', reportsTo: 'cto', summary: 'ADRs, scaffolding, hardest problems', defaultModel: OPUS },
  { id: 'qa', title: 'QA Engineer / SDET', department: 'Quality', reportsTo: 'cto', summary: 'Test plans, automated tests, sign-off', defaultModel: SONNET },
  { id: 'devops', title: 'DevOps Engineer', department: 'Platform', reportsTo: 'cto', summary: 'Docker, CI, one-command run', defaultModel: SONNET },
  { id: 'security', title: 'Security Engineer', department: 'Platform', reportsTo: 'cto', summary: 'Threat model and security review', defaultModel: OPUS },
  { id: 'database', title: 'Database Engineer', department: 'Engineering', reportsTo: 'cto', summary: 'Schema, migrations, indexes', defaultModel: SONNET },
  { id: 'data-ml', title: 'Data / ML Engineer', department: 'Engineering', reportsTo: 'cto', summary: 'Data pipelines and AI features', defaultModel: SONNET },
  { id: 'frontend', title: 'Frontend Engineer (React)', department: 'Engineering', reportsTo: 'tech-lead', summary: 'Pages, components, frontend tests', defaultModel: SONNET },
  { id: 'backend-node', title: 'Backend Engineer (Node.js)', department: 'Engineering', reportsTo: 'tech-lead', summary: 'APIs, auth, database access', defaultModel: SONNET },
  { id: 'backend-python', title: 'Backend Engineer (Python)', department: 'Engineering', reportsTo: 'tech-lead', summary: 'FastAPI / Django services', defaultModel: SONNET },
  { id: 'fullstack', title: 'Full-stack Engineer', department: 'Engineering', reportsTo: 'tech-lead', summary: 'End-to-end features on small projects', defaultModel: SONNET },
];

/** Roles that exist from day one and can't be proposed as hires. */
export const FOUNDING_ROLE_IDS = new Set(['ceo', 'hr']);

export const LEVELS: Level[] = ['sde1', 'sde2', 'senior', 'mts'];

export function roleById(id: string): OrgRole | undefined {
  return ORG_ROLES.find((role) => role.id === id);
}

/** MTS-level hires get Opus; everyone else gets their role's default model (PRD §6.3). */
export function modelFor(role: OrgRole, level: Level): string {
  return level === 'mts' ? OPUS : role.defaultModel;
}

/** Who monitors the work: the first of these roles that has someone in it. */
export const WORK_LEAD_ROLES = ['tech-lead', 'cto', 'ceo'];

/** Roles that may create tasks and update anyone's task. */
export const TASK_LEAD_ROLES = new Set(['ceo', 'cto', 'tech-lead', 'architect']);

/** Roles whose people build things in the project folder (they get code tools). */
export const BUILDER_ROLES = new Set([
  'architect',
  'frontend',
  'backend-node',
  'backend-python',
  'fullstack',
  'database',
  'data-ml',
  'qa',
  'devops',
  'security',
  'designer',
  'writer',
]);

/** Names for hires the Owner makes without naming them. */
export const PERSONA_NAMES = [
  'Aarav Kapoor', 'Meera Iyer', 'Arjun Mehta', 'Sana Qureshi', 'Priya Nair', 'Rahul Verma',
  'Kabir Shah', 'Neha Joshi', 'Vikram Rao', 'Ananya Das', 'Rohan Gupta', 'Isha Menon',
  'Dev Malhotra', 'Tara Sen', 'Kunal Bose', 'Aisha Khan', 'Nikhil Jain', 'Zara Ali',
];
