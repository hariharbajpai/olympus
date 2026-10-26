// Smoke test for the plugin MCP server: plays the Claude Code session's work loop and the
// employees' tool calls by hand, so the whole path (MCP server → daemon → company) runs without
// any model calls: brief → PRD → approval → hiring → tasks → done.
// Usage: node scripts/smoke-mcp.mjs   (starts the daemon if needed; resets the company first)
// OLYMPUS_PLUGIN_DIR points at a copy of plugin/ to test it the way a GitHub install runs it.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = process.env.OLYMPUS_PLUGIN_DIR ?? path.join(root, 'plugin');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginDir, 'dist/olympus-mcp.mjs')],
  env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
});
const client = new Client({ name: 'olympus-smoke', version: '0.1.0' });
await client.connect(transport);

const raw = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { text: res.content?.[0]?.text ?? '', isError: Boolean(res.isError) };
};
const call = async (name, args = {}) => {
  const res = await raw(name, args);
  if (res.isError) throw new Error(`${name} failed: ${res.text}`);
  return res.text;
};
const check = (ok, label) => {
  if (!ok) throw new Error(`check failed: ${label}`);
  console.log(`  ok: ${label}`);
};
const nextWork = async () => JSON.parse(await call('next_work'));
const expectWork = async (agent, label) => {
  const w = await nextWork();
  check(w.status === "work" && w.activations.length === 1 && w.activations[0].agent === agent, `${label} (got ${w.status}: ${(w.activations ?? []).map((a) => a.agent + " [" + (a.prompt.match(/New messages[^\n]*/) ?? [""])[0] + "]").join(", ")})`);
  return w.activations[0];
};
const done = (a, report) => call('activation_done', { activation_id: a.activation_id, report });
const as = (a) => ({ activation: a.activation_id });

const tools = (await client.listTools()).tools.map((t) => t.name);
check(['start_project', 'next_work', 'decide_prd', 'owner_hire', 'owner_fire', 'submit_prd', 'create_task', 'update_task', 'hire_team'].every((t) => tools.includes(t)), 'owner, loop and employee tools are listed');

// Start from day one, in Claude Code mode.
await call('company_status'); // boots the daemon if needed
const base = `http://127.0.0.1:${process.env.OLYMPUS_PORT ?? 4800}`;
const workspace = (process.env.OLYMPUS_WORKSPACE ?? '~/Olympus').replace(/^~(?=$|\/)/, os.homedir());
const token = readFileSync(path.join(workspace, '.olympus/owner-token'), 'utf8').trim();
const api = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'x-olympus-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text()}`);
};
await api('/api/company/reset', {});
await api('/api/settings', { mode: 'claude-code' });
check((await call('company_status')).includes('Aarav Kapoor'), 'company reset to the founding CEO and HR');

console.log((await call('start_project', { brief: 'Build a tic tac toe web game for two players' })).split('\n')[0]);

// CEO: PRD + staffing request.
const ceo1 = await expectWork('olympus:ceo', 'the CEO gets the brief first (and only the CEO)');
check(ceo1.prompt.includes('tic tac toe'), 'the CEO prompt carries the brief');
check((await raw('create_task', { ...as(ceo1), title: 'x', description: '', assignee: 'hr' })).isError, 'no tasks before the PRD is approved');
await call('submit_prd', { ...as(ceo1), title: 'Tic tac toe', markdown: '# PRD\n\nTwo players on a 3x3 board, win and draw detection, a restart button and a scoreboard.' });
await call('post_message', { ...as(ceo1), to: 'hr', text: 'Please propose a lean team: a Tech Lead and a full-stack engineer.' });
await call('post_message', { ...as(ceo1), to: 'owner', text: 'Status: PRD v1 is ready for you.' });
await done(ceo1, 'Submitted PRD v1 and asked HR for a team.');

// HR: proposal, but no hiring yet.
const hr1 = await expectWork('olympus:hr', 'the CEO’s request wakes HR');
await call('propose_team', {
  ...as(hr1),
  hires: [
    { role: 'tech-lead', name: 'Sana Qureshi', level: 'senior', reason: 'Runs the board.' },
    { role: 'fullstack', name: 'Priya Nair', level: 'sde2', reason: 'Builds the game.' },
  ],
});
check((await raw('hire_team', as(hr1))).isError, 'HR cannot hire before the PRD is approved');
await call('post_message', { ...as(hr1), to: 'ceo', text: 'Proposal recorded: Sana (Tech Lead), Priya (Full-stack).' });
await done(hr1, 'Proposed 2 hires.');

const ceo2 = await expectWork('olympus:ceo', 'HR’s reply wakes the CEO');
await done(ceo2, 'Nothing to do until the Owner decides.');

let w = await nextWork();
check(w.status === 'finished' && w.waitingFor === 'owner_prd', 'the loop stops and waits for the Owner’s PRD decision');
check((await call('get_prd')).includes('scoreboard'), 'the Owner can read the PRD');

// Owner approves; the company hires and plans.
await call('decide_prd', { decision: 'approve', comment: 'Ship it' });
const ceo3 = await expectWork('olympus:ceo', 'approval wakes the CEO');
await call('post_message', { ...as(ceo3), to: 'hr', text: 'Approved. Please hire the team.' });
await done(ceo3, 'Asked HR to hire.');

const hr2 = await expectWork('olympus:hr', 'HR hires after approval');
const hired = await call('hire_team', as(hr2));
check(hired.includes('Sana Qureshi') && hired.includes('Priya Nair'), 'HR hired the proposed team');
await call('post_message', { ...as(hr2), to: 'ceo', text: 'Hired Sana (tech-lead) and Priya (fullstack).' });
await done(hr2, 'Hired 2.');

const ceo4 = await expectWork('olympus:ceo', 'the CEO hears about the hires');
await call('post_message', { ...as(ceo4), to: 'tech-lead', text: 'PRD approved. Please plan the tasks and run the board.' });
await done(ceo4, 'Handed over to the Tech Lead.');

const lead1 = await expectWork('olympus:tech-lead', 'the Tech Lead gets the handoff');
await call('create_task', { ...as(lead1), title: 'Game board and rules', description: '3x3 board, turns, win/draw.', assignee: 'fullstack' });
await call('create_task', { ...as(lead1), title: 'Scoreboard and restart', description: 'Keep score, restart button.', assignee: 'fullstack' });
await done(lead1, 'Created 2 tasks.');

const dev = await expectWork('olympus:fullstack', 'the engineer gets the tasks');
check(dev.prompt.includes('Project folder:'), 'the engineer prompt includes the project folder');
await call('update_task', { ...as(dev), task_id: 'T-1', status: 'in_progress' });
await call('update_task', { ...as(dev), task_id: 'T-1', status: 'done', note: 'Board and rules work, tested.' });
await call('update_task', { ...as(dev), task_id: 'T-2', status: 'done', note: 'Scoreboard and restart work.' });
await done(dev, 'Both tasks done.');

const lead2 = await expectWork('olympus:tech-lead', 'the Tech Lead hears about finished tasks');
check(lead2.prompt.includes('All tasks are done'), 'the Tech Lead learns that every task is done');
await call('post_message', { ...as(lead2), to: 'ceo', text: 'All tasks are done and checked.' });
await done(lead2, 'Reported to the CEO.');

const ceo5 = await expectWork('olympus:ceo', 'the CEO gets the final report');
await call('post_message', { ...as(ceo5), to: 'owner', text: 'Status: done. The game is ready.' });
await done(ceo5, 'Told the Owner.');

w = await nextWork();
check(w.status === 'finished' && w.ownerMessages.some((m) => m.includes('The game is ready')), 'the run finishes with the CEO’s report for the Owner');

// Owner fires and re-hires.
await call('owner_fire', { employee: 'Meera', reason: 'Smoke test' });
check((await call('company_status')).includes('Priya Nair'), 'company_status lists the team');
check((await call('owner_hire', { role: 'hr', name: 'Isha Menon' })).includes('Isha Menon'), 'the Owner can hire a new Head of HR');

await client.close();
console.log('\nSmoke test passed.');
