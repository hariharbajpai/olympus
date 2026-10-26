# Olympus: AI tech company plugin for Claude Code

Tell your CEO what to build, approve the plan, and watch an AI company of Claude agents build it.
The full plan is in [docs/PRD.md](docs/PRD.md).

**Status: Phase 0 spike.** The founding team (CEO and Head of HR) works in parallel, talks through
company tools, and HR proposes a team. The dashboard shows it all live, including the full org chart
with reporting lines. You can fire someone mid-run.

## How it runs

No API key. Employees are **Claude Code subagents** (`olympus:ceo`, `olympus:hr`, …) that run inside
your own Claude Code session, on its login:

1. `/olympus:brief <what to build>` starts a run. The daemon gives the CEO your brief.
2. The skill runs a loop in your session: `next_work` returns the employees who have work, the
   session starts them as parallel subagents, and reports each one back with `activation_done`.
3. Employees use company tools (`post_message`, `report_status`, `list_team`, `propose_team`) from the
   plugin's MCP server. The daemon checks every call and streams everything to the dashboard.

## Set up

```bash
npm install
npm run build
```

Install the plugin in Claude Code (once). This marketplace is a local folder, so the plugin runs
in place from this repo:

```bash
claude plugin marketplace add /Users/Coding/Tech_Company_Plugin
```

```bash
claude plugin install olympus@olympus-local
```

Then start a new session in the Claude Code app and use:

- `/olympus:start`: boot the company and open the dashboard
- `/olympus:brief <what to build>`: brief the CEO and let the team work
- `/olympus:run`: let the team pick up waiting work (for example a run started from the dashboard)
- `/olympus:status`, `/olympus:stop`

Each run is capped at 8 agent runs (3 per employee) so it doesn't eat into your Claude plan. The
dashboard's **Simulated** mode runs the same flow for free, with scripted employees.

## Layout

| Path | What it is |
| --- | --- |
| `packages/shared` | Types shared by the daemon, dashboard, CLI and MCP server |
| `packages/daemon` | Fastify API + WebSocket, company scheduler, host runtime (Claude Code) and simulated runtime |
| `packages/dashboard` | React + Vite live dashboard |
| `packages/cli` | `olympus` CLI and daemon control |
| `packages/mcp` | The plugin's `company` MCP server |
| `plugin/` | The Claude Code plugin: agents, skills, `.mcp.json`, and bundles in `dist/` |
| `docs/PRD.md` | Product requirements |

Runtime data lives in `~/Olympus/.olympus/`: `owner-token`, `events.jsonl`, `daemon.log`, `daemon.pid`.

## Development

```bash
npm test                         # company + host-loop tests (no model calls)
npm run typecheck
node scripts/smoke-mcp.mjs       # drives the plugin MCP server end to end (no model calls)
npm run validate:plugin
OLYMPUS_ALLOWED_ORIGINS=http://localhost:5173 npm run dev:daemon   # terminal 1
npm run dev:dashboard                                            # terminal 2: http://localhost:5173/?token=<owner-token>
```
