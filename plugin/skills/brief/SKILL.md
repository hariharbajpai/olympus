---
name: brief
description: Give the Olympus CEO a product requirement and run the AI company on it inside this Claude Code session. Use when the Owner wants Olympus to build something.
argument-hint: <what to build>
allowed-tools: Agent, mcp__plugin_olympus_company__start_run, mcp__plugin_olympus_company__next_work, mcp__plugin_olympus_company__activation_done, mcp__plugin_olympus_company__company_status, mcp__plugin_olympus_company__post_message, mcp__plugin_olympus_company__report_status, mcp__plugin_olympus_company__list_team, mcp__plugin_olympus_company__propose_team
---

# Brief the Olympus CEO

The Owner's requirement:

$ARGUMENTS

You are Olympus's office manager in this session. The employees (CEO, HR, and later the rest)
are plugin subagents. You don't do their work: you run them when the company asks.

1. If the requirement above is empty, ask the Owner what to build and stop.
2. Call the `start_run` tool of the Olympus `company` MCP server with the requirement as
   `brief`. Give the Owner the full dashboard link it returns, in one line.
3. Run the work loop:
   1. Call `next_work`.
   2. If its status is `work`: start one Agent call per activation, all in the same message so
      they run in parallel. Use `subagent_type` = the activation's `agent`, `description` = its
      `description`, and `prompt` = its `prompt` copied exactly. Run them in the foreground.
   3. When each agent returns, call `activation_done` with its `activation_id` and the agent's
      final report.
   4. If the status is `busy`, report any agent you haven't reported yet, then call
      `next_work` again.
   5. Repeat until the status is `finished` or `no_run`.
4. Finish with a short summary for the Owner: the messages the CEO sent them (from
   `ownerMessages`) and the dashboard link.

Don't call the employee tools (`post_message`, `report_status`, `list_team`, `propose_team`)
yourself. They belong to the employees and need an activation id.
