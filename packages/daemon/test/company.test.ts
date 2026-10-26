import { describe, expect, it } from 'vitest';
import type { CompanyEvent, CompanyEventType, HostClaimResponse } from '@olympus/shared';
import { Company, CompanyError } from '../src/company.js';
import type { CompanyOptions } from '../src/company.js';
import { EventBus } from '../src/events.js';
import { HostRuntime } from '../src/runtime/host.js';
import { SimulatedRuntime } from '../src/runtime/simulated.js';
import type { ActivationRequest, ActivationResult, AgentRuntime } from '../src/runtime/types.js';

const config: CompanyOptions['config'] = {
  companyName: 'TestCo',
  maxConcurrency: 4,
  maxActivationsPerEmployee: 3,
  maxActivationsPerRun: 8,
  models: {
    ceo: { model: 'claude-opus-5-5', effort: 'medium' },
    hr: { model: 'claude-sonnet-5-5', effort: 'low' },
  },
};

function setup(
  options: { simulated?: AgentRuntime; host?: HostRuntime; config?: Partial<CompanyOptions['config']> } = {},
) {
  const bus = new EventBus(null);
  const host = options.host ?? new HostRuntime(60_000);
  const company = new Company({
    config: { ...config, ...options.config },
    bus,
    runtimes: { host, simulated: options.simulated ?? new SimulatedRuntime(5) },
  });
  return { bus, company, host };
}

function waitFor<T extends CompanyEventType>(
  bus: EventBus,
  type: T,
  predicate: (event: Extract<CompanyEvent, { type: T }>) => boolean = () => true,
  timeoutMs = 3000,
): Promise<Extract<CompanyEvent, { type: T }>> {
  type E = Extract<CompanyEvent, { type: T }>;
  const existing = bus.all().find((e) => e.type === type && predicate(e as E));
  if (existing) return Promise.resolve(existing as E);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const unsubscribe = bus.subscribe((event) => {
      if (event.type === type && predicate(event as E)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event as E);
      }
    });
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function work(response: HostClaimResponse) {
  if (response.status !== 'work') throw new Error(`Expected work, got ${response.status}`);
  return response.activations;
}

describe('Company with the simulated runtime', () => {
  it('runs the CEO and HR in parallel, records HR’s proposal, and finishes', async () => {
    const { bus, company } = setup();
    company.startDemo('Build a todo app with login', 'simulated');
    await waitFor(bus, 'demo.finished');

    const events = bus.all();
    const firstCompleted = events.findIndex((e) => e.type === 'activation.completed');
    const startedEarly = events
      .slice(0, firstCompleted)
      .filter((e): e is Extract<CompanyEvent, { type: 'activation.started' }> => e.type === 'activation.started')
      .map((e) => e.employeeId);
    expect(new Set(startedEarly)).toEqual(new Set(['ceo', 'hr']));

    const state = company.snapshot();
    expect(state.employees.find((e) => e.id === 'ceo')?.activations).toBe(2);
    expect(state.employees.find((e) => e.id === 'hr')?.activations).toBe(2);
    expect(state.employees.find((e) => e.id === 'hr')?.managerId).toBe('ceo');
    expect(state.employees.find((e) => e.id === 'ceo')?.managerId).toBeNull();
    expect(state.proposals.map((p) => p.roleId)).toEqual(['cto', 'tech-lead', 'frontend', 'backend-node', 'qa', 'devops']);
    expect(state.proposals.find((p) => p.roleId === 'cto')?.model).toBe('claude-opus-5-5');
    expect(state.messages.filter((m) => m.from === 'ceo' && m.to === 'owner')).toHaveLength(2);
  });

  it('fires an employee mid-run and blocks messages to them', async () => {
    const { bus, company } = setup({ simulated: new SimulatedRuntime(40) });
    company.startDemo('Build a todo app with login', 'simulated');
    await waitFor(bus, 'activation.started', (e) => e.employeeId === 'hr');

    company.fire('hr', 'Testing the fire flow');

    const completed = await waitFor(bus, 'activation.completed', (e) => e.employeeId === 'hr');
    expect(completed.outcome).toBe('aborted');
    await waitFor(bus, 'demo.finished');

    const state = company.snapshot();
    expect(state.employees.find((e) => e.id === 'hr')?.status).toBe('fired');
    expect(state.messages.some((m) => m.from === 'ceo' && m.to === 'hr')).toBe(false);
    expect(state.messages.some((m) => m.from === 'system' && m.text.includes('has left the company'))).toBe(true);
    expect(() => company.fire('hr', 'again')).toThrow(CompanyError);
  });

  it('enforces messaging and hiring rules in code', async () => {
    const results: Record<string, { ok: boolean; text: string }> = {};
    const runtime: AgentRuntime = {
      mode: 'simulated',
      async run(req: ActivationRequest): Promise<ActivationResult> {
        if (req.employee.id === 'hr') {
          results.hrToOwner = req.tools.postMessage('owner', 'Hi Owner, HR here');
          results.unknownPerson = req.tools.postMessage('nobody', 'hello');
          results.unknownChannel = req.tools.postMessage('#random', 'hello');
          results.unknownRole = req.tools.proposeTeam([{ role: 'janitor', name: 'Sam Lee', level: 'sde1', reason: '' }]);
          results.founderRole = req.tools.proposeTeam([{ role: 'ceo', name: 'Sam Lee', level: 'mts', reason: '' }]);
        } else {
          results.ceoProposes = req.tools.proposeTeam([{ role: 'qa', name: 'Sam Lee', level: 'sde1', reason: '' }]);
        }
        return { outcome: 'success', durationMs: 1 };
      },
    };
    const { bus, company } = setup({ simulated: runtime });
    company.startDemo('Build a todo app', 'simulated');
    await waitFor(bus, 'demo.finished');
    for (const result of Object.values(results)) expect(result.ok).toBe(false);
    expect(results.hrToOwner?.text).toContain('Only the CEO');
    expect(results.ceoProposes?.text).toContain('Only HR');
    expect(company.snapshot().proposals).toHaveLength(0);
  });

  it('stops starting activations at the per-run limit', async () => {
    const runtime: AgentRuntime = {
      mode: 'simulated',
      async run(req: ActivationRequest): Promise<ActivationResult> {
        // CEO and HR keep pinging each other: the run limit has to stop them.
        await new Promise((r) => setTimeout(r, 2));
        req.tools.postMessage(req.employee.id === 'ceo' ? 'hr' : 'ceo', 'ping');
        return { outcome: 'success', durationMs: 1 };
      },
    };
    const { bus, company } = setup({ simulated: runtime, config: { maxActivationsPerRun: 3, maxActivationsPerEmployee: 10 } });
    company.startDemo('Build a todo app', 'simulated');
    await waitFor(bus, 'demo.finished');
    expect(company.snapshot().activationsThisRun).toBe(3);
    expect(bus.all().some((e) => e.type === 'system.notice' && e.text.includes('limit of 3'))).toBe(true);
  });
});

describe('Company with the Claude Code host runtime', () => {
  it('hands work to the session, routes tool calls, and reports when the run finishes', async () => {
    const { bus, company } = setup();
    expect(company.hostClaim().status).toBe('no_run');

    company.startDemo('Build an expense tracker', 'claude-code');
    await tick();

    const first = work(company.hostClaim());
    expect(first.map((a) => a.agent).sort()).toEqual(['olympus:ceo', 'olympus:hr']);
    const ceo = first.find((a) => a.agent === 'olympus:ceo')!;
    const hr = first.find((a) => a.agent === 'olympus:hr')!;
    expect(ceo.prompt).toContain(ceo.activation_id);
    expect(ceo.prompt).toContain('Build an expense tracker');
    expect(company.snapshot().host).toMatchObject({ waiting: 0, running: 2 });

    // Claimed work isn't handed out twice.
    expect(company.hostClaim()).toMatchObject({ status: 'busy', running: 2 });

    expect(company.hostTool(ceo.activation_id, 'post_message', { to: 'hr', text: 'Please draft a staffing proposal.' }).ok).toBe(true);
    expect(company.hostTool(ceo.activation_id, 'post_message', { to: 'owner', text: 'Status: on track' }).ok).toBe(true);
    expect(company.hostTool(hr.activation_id, 'post_message', { to: '#general', text: 'Hi, I am Meera.' }).ok).toBe(true);
    expect(company.hostDone(ceo.activation_id, 'Asked HR for a proposal.')).toBe(true);
    expect(company.hostDone(hr.activation_id, 'Introduced myself.')).toBe(true);
    await tick();

    // An ended activation's id no longer works.
    expect(company.hostTool(ceo.activation_id, 'post_message', { to: '#general', text: 'late' }).ok).toBe(false);
    expect(company.hostDone(ceo.activation_id, 'again')).toBe(false);

    // The CEO's message wakes HR up.
    const second = work(company.hostClaim());
    expect(second).toHaveLength(1);
    expect(second[0]?.agent).toBe('olympus:hr');
    expect(second[0]?.prompt).toContain('Please draft a staffing proposal.');
    const proposal = company.hostTool(second[0]!.activation_id, 'propose_team', {
      hires: [{ role: 'cto', name: 'Arjun Mehta', level: 'mts', reason: 'Owns the design.' }],
    });
    expect(proposal.ok).toBe(true);
    expect(company.hostDone(second[0]!.activation_id, 'Proposed a CTO.')).toBe(true);
    await tick();

    const end = company.hostClaim();
    expect(end.status).toBe('finished');
    if (end.status === 'finished') expect(end.ownerMessages.join('\n')).toContain('Status: on track');
    expect(company.snapshot().proposals[0]).toMatchObject({ roleId: 'cto', name: 'Arjun Mehta' });
    expect(bus.all().some((e) => e.type === 'agent.note' && e.text === 'Asked HR for a proposal.')).toBe(true);
  });

  it('gives work back to the inbox when the session never reports', async () => {
    const { company } = setup({ host: new HostRuntime(20) });
    company.startDemo('Build an expense tracker', 'claude-code');
    await tick();
    const first = work(company.hostClaim());
    expect(first).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 60));
    // Both activations timed out and were queued again with the same messages.
    const retry = work(company.hostClaim());
    expect(retry).toHaveLength(2);
    expect(retry.map((a) => a.activation_id)).not.toContain(first[0]?.activation_id);
    expect(company.snapshot().activationsThisRun).toBe(2);
  });

  it('cuts a fired employee’s tools off while their subagent is still running', async () => {
    const { company } = setup();
    company.startDemo('Build an expense tracker', 'claude-code');
    await tick();
    const hr = work(company.hostClaim()).find((a) => a.agent === 'olympus:hr')!;
    company.fire('hr', 'Owner decision');
    const late = company.hostTool(hr.activation_id, 'post_message', { to: '#general', text: 'still here?' });
    expect(late.ok).toBe(false);
    expect(late.text).toContain('Stop now');
  });
});
