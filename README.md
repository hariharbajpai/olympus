# Olympus: AI tech company plugin for Claude Code

Tell your CEO what to build, approve the plan, and watch an AI company of Claude agents build it.
The full plan is in [docs/PRD.md](docs/PRD.md).

**Status: Phase 1.** The company starts with a CEO and a Head of HR. Brief the CEO, approve the PRD,
and watch HR hire the team, the Tech Lead plan the tasks and run the board, and the engineers build it,
all live on a dashboard with an org chart, a task board and progress charts.

## How it runs

No API key. Employees are **Claude Code subagents** (`olympus:ceo`, `olympus:hr`, `olympus:tech-lead`,
`olympus:frontend`, … 16 roles) that run inside your own Claude Code session, on its login.

1. **Brief.** `/olympus:brief <what to build>` (or the dashboard) starts a project. The CEO writes a PRD
   and HR proposes a team.
2. **Approve.** The PRD shows on the dashboard's Project page. Approve it there or with
   `/olympus:approve`; ask for changes with `/olympus:changes <what to change>`. Nothing is hired and no
   task starts before you approve: the daemon enforces it.
3. **Build.** HR hires the proposed team; their cards appear on the org chart under their managers. The
   Tech Lead breaks the PRD into tasks, and hears about every finished or blocked task until the board
   is done. Engineers write the code in your session's project folder (see below).
4. Work moves while `/olympus:brief`, `/olympus:run` or another `/olympus` command runs the work loop in
   your session. A run is capped at 60 agent runs (12 per person); change it in Settings.

The dashboard's **Simulated** mode (Settings) runs the same flow for free, with scripted employees.

### Working in your existing project

Olympus works in the folder of the Claude Code session you brief it from. Open a chat in a project
you already have, run `/olympus:brief <what to change>`, and the team works in that project. No new
project is made. Olympus scans the code first (languages, layout, build files, README, and your
`CLAUDE.md` or `AGENTS.md`) and gives every employee that overview. The CEO writes the PRD as a change
to your product, HR staffs for your stack, and engineers read the code around each task, keep its
conventions, and leave git commits to you. The dashboard's Project page shows the folder and the
overview.

- An empty folder: the team builds from scratch there.
- Your home folder, the filesystem root, or no folder: Olympus makes a new one in `~/Olympus/projects/`.
- Want a separate new project from inside an existing one? Say so in the brief ("as a new project"),
  and Claude Code asks Olympus for a new folder.
- Briefs from the dashboard always get a new folder.

## Commands

| Command | What it does |
| --- | --- |
| `/olympus:start` | Start the company and open the dashboard |
| `/olympus:brief <what to build or change>` | The CEO gets the brief, then the team works in this session's project folder |
| `/olympus:prd` | Show the PRD waiting for you |
| `/olympus:approve [note]` · `/olympus:changes <what>` | Decide on the PRD, then the team works |
| `/olympus:tell <message>` | Message the CEO, then the team works |
| `/olympus:hire <role> [name]` · `/olympus:fire <name> [reason]` | Hire or fire anyone, including the CEO and HR |
| `/olympus:run` | Let the team pick up waiting work (for example after you acted on the dashboard) |
| `/olympus:status` · `/olympus:stop` | Status, and stop the daemon (state is saved) |

## Install

The plugin ships ready to run: `plugin/dist` holds the CLI, the MCP server, the daemon and the
dashboard, so installing it needs no build step. In a terminal:

```bash
claude plugin marketplace add hariharbajpai/olympus
```

```bash
claude plugin install olympus@olympus
```

To get a newer version later: `claude plugin marketplace update olympus`, then
`claude plugin update olympus@olympus`, and start a new Claude Code session.

To try your local checkout instead, add the folder as the marketplace
(`claude plugin marketplace add /path/to/this/repo`) and install the same way.

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
| `packages/daemon` | Fastify API + WebSocket, company rules and scheduler, projects, PRD, tasks, host runtime (Claude Code) and simulated runtime |
| `packages/dashboard` | React + Vite dashboard: sidebar sections, org chart, PRD review, task board, charts |
| `packages/cli` | `olympus` CLI and daemon control |
| `packages/mcp` | The plugin's `company` MCP server |
| `plugin/` | The Claude Code plugin: agents, skills, `.mcp.json`, and the built bundles in `dist/` (committed) |
| `docs/PRD.md` | Product requirements |

Runtime data lives in `~/Olympus/.olympus/` (`company.json` keeps the company across restarts, plus `owner-token`, `events.jsonl`, `daemon.log`). Projects briefed from a session work in that session's folder; the rest go in `~/Olympus/projects/`.

## Development

```bash
npm install
npm run build                    # regenerates agents and skills, builds everything, refreshes plugin/dist
npm test                         # company + host-loop tests (no model calls)
npm run typecheck
node scripts/smoke-mcp.mjs       # drives the plugin MCP server end to end (no model calls)
npm run validate:plugin
OLYMPUS_ALLOWED_ORIGINS=http://localhost:5173 npm run dev:daemon   # terminal 1
npm run dev:dashboard                                            # terminal 2: http://localhost:5173/?token=<owner-token>
```

`plugin/dist` is committed on purpose, because an installed plugin has no build step. After changing
the source, run `npm run build` and commit `plugin/dist` too.
