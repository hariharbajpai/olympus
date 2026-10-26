// Smoke test for the plugin MCP server: plays the Claude Code session's work loop and the
// employees' tool calls by hand, so the whole path (MCP server → daemon → company) runs without
// any model calls. Usage: node scripts/smoke-mcp.mjs   (starts the daemon if needed)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'plugin/dist/olympus-mcp.mjs')],
});
const client = new Client({ name: 'olympus-smoke', version: '0.0.1' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  return text;
};
const step = (label, value) => console.log(`\n# ${label}\n${value}`);
const check = (ok, label) => {
  if (!ok) throw new Error(`check failed: ${label}`);
  console.log(`  ok: ${label}`);
};

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
step('tools', tools.join(', '));
check(tools.includes('next_work') && tools.includes('propose_team'), 'loop and employee tools are listed');

step('start_run', (await call('start_run', { brief: 'Smoke test: a tiny todo app with login' })).replace(/token=\w+/, 'token=…'));

let work = JSON.parse(await call('next_work'));
check(work.status === 'work' && work.activations.length === 2, 'CEO and HR get work in parallel');
const ceo = work.activations.find((a) => a.agent === 'olympus:ceo');
const hr = work.activations.find((a) => a.agent === 'olympus:hr');
check(ceo && hr, 'activations name the plugin subagents olympus:ceo and olympus:hr');

await call('post_message', { activation: ceo.activation_id, to: '#general', text: 'Kickoff: a tiny todo app with login.' });
await call('post_message', { activation: ceo.activation_id, to: 'hr', text: 'Please propose a lean team: CTO, one full-stack engineer, QA.' });
await call('post_message', { activation: ceo.activation_id, to: 'owner', text: 'Status: on track · Next: PRD v1' });
await call('post_message', { activation: hr.activation_id, to: '#general', text: 'Hi, I am Meera, Head of HR.' });
const denied = await client.callTool({ name: 'post_message', arguments: { activation: hr.activation_id, to: 'owner', text: 'hi' } });
check(denied.isError, 'HR cannot message the Owner');
await call('activation_done', { activation_id: ceo.activation_id, report: 'Kicked off and asked HR for a team.' });
await call('activation_done', { activation_id: hr.activation_id, report: 'Introduced myself.' });

work = JSON.parse(await call('next_work'));
check(work.status === 'work' && work.activations.length === 1 && work.activations[0].agent === 'olympus:hr', 'the CEO’s message wakes HR');
const hr2 = work.activations[0];
step('propose_team', await call('propose_team', {
  activation: hr2.activation_id,
  hires: [
    { role: 'cto', name: 'Arjun Mehta', level: 'mts', reason: 'Owns the design.' },
    { role: 'fullstack', name: 'Priya Nair', level: 'sde2', reason: 'Builds the app.' },
    { role: 'qa', name: 'Kabir Shah', level: 'sde2', reason: 'Tests it.' },
  ],
}));
await call('post_message', { activation: hr2.activation_id, to: 'ceo', text: 'Proposal is on the org chart: CTO, full-stack, QA.' });
await call('activation_done', { activation_id: hr2.activation_id, report: 'Proposed 3 hires.' });

work = JSON.parse(await call('next_work'));
check(work.status === 'work' && work.activations[0].agent === 'olympus:ceo', 'HR’s reply wakes the CEO');
const ceo2 = work.activations[0];
await call('post_message', { activation: ceo2.activation_id, to: 'owner', text: 'Status: on track · HR proposed 3 hires · Next: PRD v1' });
await call('activation_done', { activation_id: ceo2.activation_id, report: 'Updated the Owner.' });

work = JSON.parse(await call('next_work'));
check(work.status === 'finished' && work.ownerMessages.length === 2, 'the run finishes with the CEO’s messages for the Owner');
step('finished', work.ownerMessages.join('\n'));
step('company_status', (await call('company_status')).replace(/token=\w+/, 'token=…'));

await client.close();
console.log('\nSmoke test passed.');
