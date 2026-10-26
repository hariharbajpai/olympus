import type { ActivationRequest, ActivationResult, AgentRuntime, HireProposalInput } from './types.js';
import { summarizeToolCall } from './types.js';

type Step =
  | { kind: 'note'; text: string }
  | { kind: 'tool'; tool: 'post_message'; to: string; text: string }
  | { kind: 'tool'; tool: 'report_status'; summary: string }
  | { kind: 'tool'; tool: 'propose_team'; hires: HireProposalInput[] };

/**
 * A free, scripted stand-in for Claude. It goes through the same company tools as the
 * Claude Code runtime, so the scheduler, messaging, firing and dashboard can be tested
 * without using the Owner's Claude plan.
 */
export class SimulatedRuntime implements AgentRuntime {
  readonly mode = 'simulated' as const;

  constructor(private readonly stepDelayMs = 900) {}

  async run(req: ActivationRequest): Promise<ActivationResult> {
    const started = Date.now();
    for (const step of scriptFor(req)) {
      await sleep(this.stepDelayMs, req.abortController.signal);
      if (step.kind === 'note') {
        req.emit({ kind: 'note', text: step.text });
        continue;
      }
      req.emit({ kind: 'action', tool: step.tool, summary: summarizeToolCall(step.tool, step) });
      const result =
        step.tool === 'post_message'
          ? req.tools.postMessage(step.to, step.text)
          : step.tool === 'report_status'
            ? req.tools.reportStatus(step.summary)
            : req.tools.proposeTeam(step.hires);
      if (!result.ok) req.emit({ kind: 'note', text: `${step.tool} failed: ${result.text}` });
    }
    return { outcome: 'success', durationMs: Date.now() - started };
  }
}

const PROPOSED_TEAM: HireProposalInput[] = [
  { role: 'cto', name: 'Arjun Mehta', level: 'mts', reason: 'Owns the architecture and the task breakdown.' },
  { role: 'tech-lead', name: 'Sana Qureshi', level: 'senior', reason: 'Assigns work and reviews code for the engineers.' },
  { role: 'frontend', name: 'Priya Nair', level: 'sde2', reason: 'Builds the React screens.' },
  { role: 'backend-node', name: 'Rahul Verma', level: 'sde2', reason: 'Builds the API, auth and receipt storage.' },
  { role: 'qa', name: 'Kabir Shah', level: 'sde2', reason: 'Test plan and automated tests.' },
  { role: 'devops', name: 'Neha Joshi', level: 'sde2', reason: 'Docker setup and a one-command run.' },
];

function scriptFor(req: ActivationRequest): Step[] {
  const fromOwner = req.inbox.find((item) => item.from === 'owner');
  const fromCeo = req.inbox.some((item) => item.from === 'ceo');
  const fromHr = req.inbox.some((item) => item.from === 'hr');
  const fromSystem = req.inbox.some((item) => item.from === 'system');
  const role = req.employee.roleId;

  if (role === 'ceo' && fromOwner) {
    const brief = shorten(fromOwner.text, 80);
    return [
      { kind: 'note', text: 'Reading the Owner’s brief and listing the users, core problem and constraints.' },
      { kind: 'tool', tool: 'report_status', summary: 'Reading the Owner’s brief' },
      {
        kind: 'tool',
        tool: 'post_message',
        to: '#general',
        text: `Kickoff: we're starting "${brief}". I'll write the PRD for the Owner first. HR is preparing a staffing proposal so we can move fast once it's approved.`,
      },
      {
        kind: 'tool',
        tool: 'post_message',
        to: 'hr',
        text: `Please draft a staffing proposal for "${brief}". Roles I expect: CTO (MTS), a Tech Lead, one frontend and one Node.js backend engineer, QA, and DevOps. Keep it lean. Nobody is hired before the Owner approves the PRD.`,
      },
      {
        kind: 'tool',
        tool: 'post_message',
        to: 'owner',
        text: 'Status: on track · Done: read your brief, asked HR for a staffing proposal · Next: PRD v1 for your approval · Needs from you: nothing yet',
      },
      { kind: 'tool', tool: 'report_status', summary: 'Waiting for HR’s staffing proposal' },
    ];
  }

  if (role === 'ceo' && fromHr) {
    return [
      { kind: 'note', text: 'Checking HR’s proposal against the brief: six roles, sensible levels.' },
      {
        kind: 'tool',
        tool: 'post_message',
        to: 'owner',
        text: 'Status: on track · Done: HR proposed a 6-person team under the CTO (see the org chart) · Next: PRD v1 · Needs from you: approve the PRD when it arrives',
      },
      { kind: 'tool', tool: 'report_status', summary: 'Drafting PRD v1 (next phase)' },
    ];
  }

  if (role === 'hr' && fromCeo) {
    return [
      { kind: 'note', text: 'Matching each requested role to a level and model.' },
      { kind: 'tool', tool: 'report_status', summary: 'Preparing a staffing proposal' },
      { kind: 'tool', tool: 'propose_team', hires: PROPOSED_TEAM },
      {
        kind: 'tool',
        tool: 'post_message',
        to: 'ceo',
        text: 'Staffing proposal is on the org chart: CTO Arjun (MTS) with Tech Lead Sana (Senior), Priya (Frontend), Rahul (Node.js backend), Kabir (QA) and Neha (DevOps), all SDE-II. Nobody is hired until the Owner approves the PRD.',
      },
      { kind: 'tool', tool: 'post_message', to: '#general', text: 'A staffing proposal is with the CEO.' },
    ];
  }

  if (role === 'hr' && fromSystem) {
    return [
      { kind: 'note', text: 'First day. Writing a short introduction with our hiring principles.' },
      {
        kind: 'tool',
        tool: 'post_message',
        to: '#general',
        text: [
          'Hi all, I’m Meera, Head of HR. How we hire:',
          '• Smallest team that fits the work.',
          '• Reassign before we hire.',
          '• Nobody joins a project before the Owner approves its PRD.',
        ].join('\n'),
      },
    ];
  }

  return [{ kind: 'note', text: 'Nothing in these messages needs action from me.' }];
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
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
