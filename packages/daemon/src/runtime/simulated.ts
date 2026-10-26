import type { ActivationRequest, ActivationResult, AgentRuntime, InboxItem, ToolResult } from './types.js';
import { summarizeToolCall } from './types.js';

/**
 * A free, scripted stand-in for Claude. It goes through the same company tools as the Claude Code
 * runtime, so the whole flow (brief → PRD → approval → hiring → tasks → done) and the dashboard
 * can be tried without using the Owner's Claude plan.
 */
export class SimulatedRuntime implements AgentRuntime {
  readonly mode = 'simulated' as const;

  constructor(private readonly stepDelayMs = 600) {}

  async run(req: ActivationRequest): Promise<ActivationResult> {
    const started = Date.now();
    const signal = req.abortController.signal;
    const ctx: Ctx = {
      note: async (text) => {
        await sleep(this.stepDelayMs, signal);
        req.emit({ kind: 'note', text });
      },
      call: async (tool, input = {}) => {
        await sleep(this.stepDelayMs, signal);
        req.emit({ kind: 'action', tool, summary: summarizeToolCall(tool, input) });
        const result = req.tools.call(tool, input);
        if (!result.ok) req.emit({ kind: 'note', text: `${tool} failed: ${result.text}` });
        return result;
      },
    };
    await script(req, ctx);
    return { outcome: 'success', durationMs: Date.now() - started };
  }
}

interface Ctx {
  note(text: string): Promise<void>;
  call(tool: string, input?: Record<string, unknown>): Promise<ToolResult>;
}

interface Person {
  name: string;
  title: string;
  id: string;
}

function parseTeam(text: string): Person[] {
  const people: Person[] = [];
  for (const line of text.split('\n')) {
    const match = /^- (.+?), (.+?): id "([^"]+)"/.exec(line);
    if (match) people.push({ name: match[1]!, title: match[2]!, id: match[3]! });
  }
  return people;
}

const roleOf = (id: string) => id.replace(/-\d+$/, '');
const has = (inbox: InboxItem[], pred: (i: InboxItem) => boolean) => inbox.some(pred);
const fromRole = (role: string) => (i: InboxItem) => i.from !== 'owner' && i.from !== 'system' && roleOf(i.from) === role;
const mentions = (word: string) => (i: InboxItem) => i.text.toLowerCase().includes(word);

const LEADS = new Set(['tech-lead', 'cto']);

const TASKS_BY_ROLE: Record<string, Array<[string, string]>> = {
  frontend: [
    ['Build the main screens', 'Create the React UI for the core flows in the PRD, with clean components.'],
    ['Responsive and accessible UI', 'Make every screen work on phone and desktop, with keyboard support and labels.'],
  ],
  'backend-node': [
    ['Core API and data model', 'Build the Node.js API and data model the PRD needs, with input validation.'],
    ['Persistence and error handling', 'Store data safely and return clear errors.'],
  ],
  'backend-python': [
    ['Core API and data model', 'Build the FastAPI service and data model the PRD needs.'],
    ['Persistence and error handling', 'Store data safely and return clear errors.'],
  ],
  fullstack: [
    ['Build the app end to end', 'Implement every PRD user story, UI and logic.'],
    ['Unit tests for the core logic', 'Cover the rules and edge cases with automated tests.'],
  ],
  qa: [
    ['Test plan from the acceptance criteria', 'Map each PRD acceptance criterion to a test.'],
    ['Automated tests and bug report', 'Automate the plan, run it, and report anything that fails.'],
  ],
  devops: [['One-command run', 'Add a run script and README steps so the app starts with one command.']],
  designer: [['Screen designs', 'Design the main screens and the UI copy.']],
  writer: [['README and user guide', 'Write setup, run and usage docs.']],
};

const SIM_PRD = (brief: string, version: number, change?: string) => `# PRD v${version}

## 1. Summary
${brief}

## 2. Goals
- Ship a small, working first version that does exactly what the brief asks.
- Keep it simple to run: one command, clear README.

## 3. Users
The Owner and the people they share it with.

## 4. User stories
1. **As a user, I can use the core feature end to end.**
   - Given the app is open, when I complete the main flow, then I see the expected result.
2. **As a user, I get clear feedback when something goes wrong.**
   - Given invalid input, when I submit it, then I see a helpful message.

## 5. Scope
- **MVP:** the core flow, basic styling, automated tests for the main rules.
- **Later:** accounts, sharing, analytics.

## 6. Non-functional
- Loads in under 2 seconds on a laptop.
- Works on the latest Chrome, Safari and Firefox, phone and desktop.

## 7. Team and plan
Tech Lead, frontend, backend and QA, in parallel. Done when every task on the board is done and tests pass.
${change ? `\n## Changes in v${version}\n- ${change}\n` : ''}`;

async function script(req: ActivationRequest, ctx: Ctx): Promise<void> {
  const { inbox } = req;
  const role = req.employee.roleId;

  if (role === 'ceo') {
    const brief = inbox.find((i) => i.kind === 'brief');
    if (brief) {
      await ctx.note('Reading the Owner’s brief: users, core problem, scope.');
      await ctx.call('report_status', { summary: 'Writing PRD v1' });
      await ctx.call('post_message', { to: '#general', text: `Kickoff: we're building “${brief.text.slice(0, 80)}”. PRD first, then the team.` });
      await ctx.call('post_message', {
        to: 'hr',
        text: 'Please draft a staffing proposal: a Tech Lead (Senior), one frontend and one Node.js backend engineer (SDE-II), and QA (SDE-II). Nobody is hired before the Owner approves the PRD.',
      });
      await ctx.call('submit_prd', { title: 'First version', markdown: SIM_PRD(brief.text, 1) });
      await ctx.call('post_message', {
        to: 'owner',
        text: 'Status: on track · Done: PRD v1 is ready for you · Next: HR is drafting the team · Needs from you: approve the PRD (Project page) or ask for changes.',
      });
      await ctx.call('report_status', { summary: 'Waiting for the Owner to approve PRD v1' });
      return;
    }
    const changes = inbox.find((i) => i.kind === 'prd_changes');
    if (changes) {
      const project = await ctx.call('get_project');
      const brief2 = /Brief: (.*)/.exec(project.text)?.[1] ?? 'the product';
      const ask = changes.text.split('\n')[1] ?? 'the Owner’s comments';
      await ctx.note('Revising the PRD with the Owner’s comments.');
      const version = Number(/PRD v(\d+)/.exec(changes.text)?.[1] ?? '1') + 1;
      await ctx.call('submit_prd', { title: `Revision ${version}`, markdown: SIM_PRD(brief2, version, ask) });
      await ctx.call('post_message', { to: 'owner', text: `Status: on track · Done: PRD v${version} addresses your comments · Needs from you: approve or ask for more changes.` });
      return;
    }
    if (has(inbox, (i) => i.kind === 'prd_approved')) {
      await ctx.call('post_message', { to: 'hr', text: 'The Owner approved the PRD. Please hire the proposed team with hire_team.' });
      await ctx.call('report_status', { summary: 'Hiring the team' });
      return;
    }
    if (has(inbox, (i) => fromRole('hr')(i) && mentions('hired')(i))) {
      const team = parseTeam((await ctx.call('list_team')).text);
      const lead = team.find((p) => LEADS.has(roleOf(p.id)));
      if (lead) {
        await ctx.call('post_message', { to: lead.id, text: 'The PRD is approved and the team is hired. Please break it into tasks, assign them, and keep me posted until everything is done.' });
      } else {
        for (const p of team.filter((x) => !['ceo', 'hr'].includes(roleOf(x.id)))) {
          await ctx.call('create_task', { title: 'Build your part of the PRD', description: 'Deliver your part and tests.', assignee: p.id });
        }
      }
      await ctx.call('report_status', { summary: 'Team is building' });
      return;
    }
    if (has(inbox, (i) => fromRole('hr')(i) && mentions('proposal')(i))) {
      await ctx.call('post_message', { to: 'owner', text: 'Status: on track · HR proposed the team (see Project → Staffing) · Needs from you: approve PRD v1 so we can hire.' });
      return;
    }
    if (has(inbox, mentions('all tasks are done'))) {
      await ctx.call('post_message', { to: 'owner', text: 'Status: done · Every task on the board is complete and checked by the Tech Lead. The build is ready for your review.' });
      await ctx.call('report_status', { summary: 'Project complete' });
      return;
    }
    const owner = inbox.find((i) => i.kind === 'owner');
    if (owner) {
      await ctx.call('post_message', { to: 'owner', text: `Got it: “${owner.text.slice(0, 100)}”. I’ll take it into account and keep you posted.` });
      return;
    }
    if (has(inbox, (i) => i.kind === 'onboarding')) {
      await ctx.call('get_project');
      await ctx.call('post_message', { to: '#general', text: `Hi all, I’m ${req.employee.name}, the new CEO. Picking up where we left off.` });
      return;
    }
    await ctx.note('Nothing here needs action from me.');
    return;
  }

  if (role === 'hr') {
    if (has(inbox, (i) => fromRole('ceo')(i) && mentions('staffing')(i))) {
      await ctx.call('report_status', { summary: 'Drafting the staffing proposal' });
      await ctx.call('propose_team', {
        hires: [
          { role: 'tech-lead', name: 'Sana Qureshi', level: 'senior', reason: 'Plans the tasks and monitors the work end to end.' },
          { role: 'frontend', name: 'Priya Nair', level: 'sde2', reason: 'Builds the screens.' },
          { role: 'backend-node', name: 'Rahul Verma', level: 'sde2', reason: 'Builds the API and data.' },
          { role: 'qa', name: 'Kabir Shah', level: 'sde2', reason: 'Tests against the acceptance criteria.' },
        ],
      });
      await ctx.call('post_message', { to: 'ceo', text: 'Staffing proposal recorded: Sana (Tech Lead, Senior), Priya (Frontend), Rahul (Node.js backend), Kabir (QA), all ready to hire once the PRD is approved.' });
      return;
    }
    if (has(inbox, (i) => fromRole('ceo')(i) && mentions('hire')(i))) {
      const result = await ctx.call('hire_team');
      await ctx.call('post_message', { to: 'ceo', text: result.ok ? `Hired the team.\n${result.text}` : `Could not hire yet: ${result.text}` });
      return;
    }
    await ctx.call('post_message', { to: '#general', text: `Hi all, I’m ${req.employee.name}, Head of HR. Smallest team that fits the work; nobody joins before the PRD is approved.` });
    return;
  }

  if (LEADS.has(role)) {
    if (has(inbox, (i) => i.kind === 'task_update')) {
      const done = has(inbox, mentions('all tasks are done'));
      if (done) {
        await ctx.call('list_tasks');
        await ctx.call('post_message', { to: 'ceo', text: 'All tasks are done and checked. The build is ready.' });
        await ctx.call('report_status', { summary: 'All tasks done' });
      } else {
        const board = /Board: ([^.\n]+)/.exec(inbox.at(-1)?.text ?? '')?.[1] ?? '';
        await ctx.call('report_status', { summary: `Monitoring the board: ${board}` });
      }
      return;
    }
    const team = parseTeam((await ctx.call('list_team')).text);
    const builders = team.filter((p) => TASKS_BY_ROLE[roleOf(p.id)]);
    await ctx.note(`Breaking the PRD into tasks for ${builders.length} people.`);
    for (const person of builders) {
      for (const [title, description] of TASKS_BY_ROLE[roleOf(person.id)] ?? []) {
        await ctx.call('create_task', { title, description, assignee: person.id });
      }
    }
    await ctx.call('post_message', { to: '#general', text: 'The plan is on the task board. Move your tasks as you go; I’m watching the board until we’re done.' });
    await ctx.call('report_status', { summary: 'Monitoring the task board' });
    return;
  }

  // Engineers, QA, DevOps, Designer, Writer: work through the tasks they were given.
  const taskIds = [...new Set(inbox.flatMap((i) => [...i.text.matchAll(/\b(T-\d+)\b/g)].map((m) => m[1]!)))];
  if (taskIds.length === 0) {
    await ctx.note('No task in these messages.');
    return;
  }
  for (const id of taskIds) {
    await ctx.call('update_task', { task_id: id, status: 'in_progress', note: 'Started.' });
    await ctx.note(`Working on ${id}.`);
    await ctx.call('update_task', { task_id: id, status: 'done', note: 'Done, with tests.' });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Aborted'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
