import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompanyEvent, CompanyEventType, HostClaimResponse, Settings } from '@olympus/shared';
import { Company, CompanyError, type CompanyOptions, type SavedCompany } from '../src/company.js';
import { EventBus } from '../src/events.js';
import { activationPrompt } from '../src/prompts.js';
import { HostRuntime } from '../src/runtime/host.js';
import { SimulatedRuntime } from '../src/runtime/simulated.js';
import type { ActivationRequest, ActivationResult, AgentRuntime } from '../src/runtime/types.js';

const projectsDir = path.join(os.tmpdir(), 'olympus-test-projects');

function setup(opts: { mode?: Settings['mode']; simulated?: AgentRuntime; host?: HostRuntime; settings?: Partial<Settings>; persist?: CompanyOptions['persist'] } = {}) {
  const bus = new EventBus(null);
  const host = opts.host ?? new HostRuntime(60_000);
  const company = new Company({
    companyName: 'TestCo',
    projectsDir,
    settings: {
      mode: opts.mode ?? 'simulated',
      maxConcurrency: 4,
      maxActivationsPerEmployee: 12,
      maxActivationsPerProject: 60,
      ...opts.settings,
    },
    bus,
    runtimes: { host, simulated: opts.simulated ?? new SimulatedRuntime(2) },
    ...(opts.persist ? { persist: opts.persist } : {}),
  });
  return { bus, company, host };
}

function waitFor<T extends CompanyEventType>(
  bus: EventBus,
  type: T,
  predicate: (event: Extract<CompanyEvent, { type: T }>) => boolean = () => true,
  timeoutMs = 5000,
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

async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function work(response: HostClaimResponse) {
  if (response.status !== 'work') throw new Error(`Expected work, got ${response.status}: ${JSON.stringify(response)}`);
  return response.activations;
}

/** A runtime that runs a function per employee role. */
function scripted(fn: (req: ActivationRequest) => void | Promise<void>): AgentRuntime {
  return {
    mode: 'simulated',
    async run(req: ActivationRequest): Promise<ActivationResult> {
      await fn(req);
      return { outcome: 'success', durationMs: 1 };
    },
  };
}

describe('starting state', () => {
  it('has only the CEO and HR, and HR reports to the CEO', () => {
    const { company } = setup();
    const state = company.snapshot();
    expect(state.employees.map((e) => e.id)).toEqual(['ceo', 'hr']);
    expect(state.employees.find((e) => e.id === 'hr')?.managerId).toBe('ceo');
    expect(state.employees.find((e) => e.id === 'ceo')?.managerId).toBeNull();
    expect(state.project).toBeNull();
  });
});

describe('the full simulated flow', () => {
  it('goes brief → PRD → Owner approval → hiring → tasks → done', async () => {
    const { bus, company } = setup();
    company.startProject('Build a tic tac toe game for two players');

    await waitFor(bus, 'prd.submitted');
    await waitFor(bus, 'team.proposed', (e) => e.count === 4);
    await until(() => !company.snapshot().busy);
    let state = company.snapshot();
    expect(state.project?.phase).toBe('prd_review');
    expect(state.waitingFor).toBe('owner_prd');
    expect(state.employees.filter((e) => e.status !== 'fired')).toHaveLength(2); // nobody hired yet
    expect(state.messages.some((m) => m.to === 'owner' && m.text.includes('PRD v1'))).toBe(true);

    company.decidePrd('approve', 'Looks good');
    await waitFor(bus, 'project.phase_changed', (e) => e.phase === 'done', 10_000);
    await until(() => !company.snapshot().busy, 10_000);

    state = company.snapshot();
    const byRole = (roleId: string) => state.employees.find((e) => e.roleId === roleId);
    expect(state.employees.filter((e) => e.status !== 'fired')).toHaveLength(6);
    // Hierarchy: engineers report to the Tech Lead; with no CTO the Tech Lead reports to the CEO.
    expect(byRole('frontend')?.managerId).toBe(byRole('tech-lead')?.id);
    expect(byRole('qa')?.managerId).toBe('ceo');
    expect(byRole('tech-lead')?.managerId).toBe('ceo');
    expect(state.tasks.length).toBeGreaterThan(0);
    expect(state.tasks.every((t) => t.status === 'done')).toBe(true);
    expect(state.metrics.tasksDone).toHaveLength(state.tasks.length);
    expect(state.proposals).toHaveLength(0);
    expect(state.messages.some((m) => m.from === 'ceo' && m.to === 'owner' && m.text.includes('Status: done'))).toBe(true);
  });

  it('revises the PRD when the Owner asks for changes', async () => {
    const { bus, company } = setup();
    company.startProject('Build a notes app');
    await waitFor(bus, 'prd.submitted', (e) => e.version === 1);
    await until(() => !company.snapshot().busy);
    company.decidePrd('changes', 'Add dark mode');
    await waitFor(bus, 'prd.submitted', (e) => e.version === 2);
    const prd = company.snapshot().project!.prd;
    expect(prd.map((v) => v.status)).toEqual(['changes_requested', 'pending']);
    expect(prd[0]?.ownerComment).toBe('Add dark mode');
    expect(prd[1]?.markdown).toContain('Add dark mode');
  });
});

describe('rules enforced in code', () => {
  it('blocks hiring and tasks before the PRD is approved', async () => {
    const results: Record<string, { ok: boolean; text: string }> = {};
    const runtime = scripted((req) => {
      if (req.employee.roleId === 'ceo') {
        results.taskEarly = req.tools.call('create_task', { title: 'x', assignee: 'hr' });
        results.ceoHires = req.tools.call('hire_team', {});
        results.prd = req.tools.call('submit_prd', { title: 'v1', markdown: '# PRD\n'.padEnd(80, 'x') });
        req.tools.call('post_message', { to: 'hr', text: 'please propose' });
      } else {
        results.propose = req.tools.call('propose_team', { hires: [{ role: 'qa', name: 'Sam Lee', level: 'sde1', reason: '' }] });
        results.hireEarly = req.tools.call('hire_team', {});
        results.hrToOwner = req.tools.call('post_message', { to: 'owner', text: 'hi' });
      }
    });
    const { company } = setup({ simulated: runtime });
    company.startProject('Build a todo app');
    await until(() => Boolean(results.hrToOwner));
    expect(results.taskEarly?.ok).toBe(false);
    expect(results.ceoHires?.text).toContain('Only HR');
    expect(results.prd?.ok).toBe(true);
    expect(results.propose?.ok).toBe(true);
    expect(results.hireEarly?.text).toContain('after the Owner approves');
    expect(results.hrToOwner?.text).toContain('Only the CEO');
  });

  it('lets the Owner fire and re-hire the CEO, with one CEO at a time', () => {
    const { company } = setup();
    company.fire('ceo', 'Owner decision');
    expect(() => company.startProject('Build a todo app')).toThrow(CompanyError);
    expect(company.snapshot().employees.find((e) => e.id === 'hr')?.managerId).toBeNull();
    const ceo = company.ownerHire('ceo', 'Vikram Rao');
    expect(ceo.id).toBe('ceo-2');
    expect(() => company.ownerHire('ceo')).toThrow('already the Chief Executive Officer');
    expect(company.snapshot().employees.find((e) => e.id === 'hr')?.managerId).toBe('ceo-2');
    // A frontend engineer with no Tech Lead or CTO reports straight to the CEO.
    const fe = company.ownerHire('frontend', null, 'sde2');
    expect(fe.managerId).toBe('ceo-2');
  });

  it('pauses at the project limit without leaving the session looping', async () => {
    const runtime = scripted((req) => {
      req.tools.call('post_message', { to: req.employee.id === 'ceo' ? 'hr' : 'ceo', text: 'ping' });
    });
    const { bus, company } = setup({ simulated: runtime, settings: { maxActivationsPerProject: 3 } });
    company.startProject('Build a todo app');
    await waitFor(bus, 'system.notice', (e) => e.text.includes('limit of 3'));
    await until(() => !company.snapshot().busy);
    expect(company.snapshot().activationsThisProject).toBe(3);
    company.updateSettings({ maxActivationsPerProject: 5 });
    await until(() => company.snapshot().activationsThisProject === 5);
  });
});

describe('the Claude Code host loop', () => {
  it('hands work to the session and waits for the Owner after the PRD', async () => {
    const { company } = setup({ mode: 'claude-code' });
    expect(company.hostClaim().status).toBe('no_run');
    company.startProject('Build a tic tac toe game');
    await tick();

    const [ceo] = work(company.hostClaim());
    expect(ceo?.agent).toBe('olympus:ceo');
    expect(ceo?.prompt).toContain('Build a tic tac toe game');
    expect(ceo?.prompt).toContain(ceo!.activation_id);
    expect(company.hostClaim()).toMatchObject({ status: 'busy', running: 1 });

    const prd = company.hostTool(ceo!.activation_id, 'submit_prd', { title: 'Tic tac toe', markdown: '# PRD\n\nTwo players, 3x3 board, win and draw detection, restart.' });
    expect(prd.ok).toBe(true);
    expect(company.hostDone(ceo!.activation_id, 'Submitted PRD v1.')).toBe(true);
    await tick();

    const end = company.hostClaim();
    expect(end).toMatchObject({ status: 'finished', waitingFor: 'owner_prd' });
    expect(company.hostTool(ceo!.activation_id, 'list_tasks', {}).ok).toBe(false); // ended activation

    company.decidePrd('approve', null);
    await tick();
    const [next] = work(company.hostClaim());
    expect(next?.agent).toBe('olympus:ceo');
    expect(next?.prompt).toContain('approved PRD v1');
  });

  it('gives work back to the inbox when the session never reports', async () => {
    const { company } = setup({ mode: 'claude-code', host: new HostRuntime(20) });
    company.startProject('Build an expense tracker');
    await tick();
    const first = work(company.hostClaim());
    await new Promise((r) => setTimeout(r, 60));
    const retry = work(company.hostClaim());
    expect(retry.map((a) => a.activation_id)).not.toContain(first[0]?.activation_id);
    expect(company.snapshot().activationsThisProject).toBe(1);
  });
});

describe('persistence', () => {
  it('restores the team and project after a restart', async () => {
    let saved: SavedCompany | null = null;
    const persist = { load: () => saved, save: (s: SavedCompany) => (saved = structuredClone(s)) };
    const first = setup({ mode: 'claude-code', persist });
    first.company.ownerHire('cto', 'Arjun Mehta', 'mts');
    first.company.startProject('Build a URL shortener');
    first.company.shutdown();
    expect(saved).not.toBeNull();

    const second = setup({ mode: 'claude-code', persist });
    const state = second.company.snapshot();
    expect(state.employees.map((e) => e.id)).toEqual(['ceo', 'hr', 'cto']);
    expect(state.project?.title).toBe('URL shortener');
    // The CEO's unread brief survives and becomes work again.
    await tick();
    expect(work(second.company.hostClaim())[0]?.agent).toBe('olympus:ceo');
  });
});

describe('working in the Owner’s own project folder', () => {
  const tempFolder = (name: string) => realpathSync(mkdtempSync(path.join(os.tmpdir(), `olympus-${name}-`)));
  const newFolders = () => (existsSync(projectsDir) ? readdirSync(projectsDir).length : 0);

  function existingApp(): string {
    const dir = tempFolder('existing');
    const write = (rel: string, body: string) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), body);
    };
    write('package.json', JSON.stringify({ name: 'shop-api', scripts: { test: 'vitest' }, dependencies: { fastify: '5' } }));
    write('README.md', '# Shop API\nSells things online.');
    write('CLAUDE.md', 'Use pnpm, never npm.');
    write('src/server.ts', 'export {};');
    write('src/routes/cart.ts', 'export {};');
    write('node_modules/lib/index.js', 'module.exports = {};');
    write('.git/HEAD', 'ref: refs/heads/feature-x\n');
    return dir;
  }

  it('changes the existing code there, with an overview, and makes no new folder', async () => {
    const { company } = setup({ mode: 'claude-code' });
    const dir = existingApp();
    const before = newFolders();
    const { project, note } = company.startProject('Add discount codes to the cart', { folder: dir });

    expect(project).toMatchObject({ workspaceDir: dir, ownerFolder: true, existingCode: true });
    expect(note).toBeNull();
    expect(newFolders()).toBe(before);
    expect(project.overview).toContain('TypeScript (2 files)');
    expect(project.overview).not.toContain('JavaScript'); // node_modules is skipped
    expect(project.overview).toContain('name "shop-api"');
    expect(project.overview).toContain('branch feature-x');
    expect(project.overview).toContain('Use pnpm, never npm.');
    expect(project.overview).toContain('# Shop API');

    await tick();
    const [ceo] = work(company.hostClaim());
    expect(ceo?.prompt).toContain(`Existing codebase: this work changes the code already in ${dir}`);
    const info = company.hostTool(ceo!.activation_id, 'get_project', {});
    expect(info.text).toContain('existing codebase');
    expect(info.text).toContain('## Codebase overview');
    expect(info.text).toContain('Use pnpm, never npm.');
  });

  it('tells builders to keep changes focused and leave git to the Owner', () => {
    const { company } = setup();
    const { project } = company.startProject('Add discount codes', { folder: existingApp() });
    const prompt = (isBuilder: boolean) =>
      activationPrompt({ companyName: 'TestCo', name: 'Dev', title: 'Engineer', employeeId: 'dev', activationId: 'a1', roster: '', project, isBuilder, myTasks: [], inbox: [] });
    expect(prompt(true)).toContain('Don’t commit, switch branches');
    expect(prompt(false)).not.toContain('Don’t commit');
    expect(prompt(false)).toContain('Existing codebase');
  });

  it('builds from scratch in an empty Owner folder', () => {
    const { company } = setup();
    const dir = tempFolder('empty');
    const { project } = company.startProject('Build a habit tracker', { folder: dir });
    expect(project).toMatchObject({ workspaceDir: dir, ownerFolder: true, existingCode: false, overview: null });
  });

  it('notes earlier Olympus work when a new brief lands in the same folder', () => {
    const { company } = setup();
    const dir = existingApp();
    company.startProject('Add discount codes', { folder: dir });
    const { project } = company.startProject('Add gift cards', { folder: dir });
    expect(project.overview).toContain('Earlier Olympus work in this folder: “Add discount codes”');
  });

  it('never uses the home folder, the root or Olympus’s own folders', () => {
    const { company } = setup();
    company.startProject('Build a todo app');
    const bad = [os.homedir(), path.dirname(os.homedir()), '/', projectsDir, path.join(os.tmpdir(), 'olympus-no-such-folder'), 'relative/path'];
    mkdirSync(projectsDir, { recursive: true });
    for (const folder of bad) {
      expect(() => company.startProject('Add a feature', { folder }), folder).toThrow(CompanyError);
    }
    expect(company.snapshot().project?.title).toBe('Todo app'); // the running project is untouched

    const fallback = company.startProject('Add a feature', { folder: os.homedir(), fallbackToNew: true });
    expect(fallback.project.ownerFolder).toBe(false);
    expect(fallback.project.workspaceDir.startsWith(projectsDir)).toBe(true);
    expect(fallback.note).toContain('home folder');

    // A folder Olympus made for an earlier project is a fine place to keep working.
    const old = path.join(projectsDir, 'old-app-abc123');
    mkdirSync(old, { recursive: true });
    writeFileSync(path.join(old, 'index.html'), '<h1>Old app</h1>');
    expect(company.startProject('Add a footer', { folder: old }).project).toMatchObject({ ownerFolder: true, existingCode: true });
  });

  it('restores projects saved before this feature as new-folder projects', () => {
    let saved: SavedCompany | null = null;
    const persist = { load: () => saved, save: (s: SavedCompany) => (saved = structuredClone(s)) };
    const first = setup({ persist });
    first.company.startProject('Build a URL shortener');
    first.company.shutdown();
    const old = saved!.project as unknown as Record<string, unknown>;
    delete old.ownerFolder;
    delete old.existingCode;
    delete old.overview;

    const project = setup({ persist }).company.snapshot().project;
    expect(project).toMatchObject({ ownerFolder: false, existingCode: false, overview: null });
  });
});
