---
name: approve
description: Approve the Olympus PRD that is waiting for the Owner, then let the team start hiring and building.
argument-hint: [optional note for the CEO]
allowed-tools: Agent, mcp__plugin_olympus_company__start_project, mcp__plugin_olympus_company__next_work, mcp__plugin_olympus_company__activation_done, mcp__plugin_olympus_company__company_status, mcp__plugin_olympus_company__owner_message, mcp__plugin_olympus_company__get_prd, mcp__plugin_olympus_company__decide_prd, mcp__plugin_olympus_company__owner_hire, mcp__plugin_olympus_company__owner_fire, mcp__plugin_olympus_company__post_message, mcp__plugin_olympus_company__report_status, mcp__plugin_olympus_company__list_team, mcp__plugin_olympus_company__get_project, mcp__plugin_olympus_company__list_tasks, mcp__plugin_olympus_company__create_task, mcp__plugin_olympus_company__update_task, mcp__plugin_olympus_company__submit_prd, mcp__plugin_olympus_company__propose_team, mcp__plugin_olympus_company__hire_team
---

# Approve the PRD

Owner's note (may be empty): $ARGUMENTS

1. Call `decide_prd` with `decision` = "approve" and the note above as `comment` (leave it out
   if empty). If it fails, tell the Owner why and stop.
2. Tell the Owner in one line that the PRD is approved and the team will now hire and build.
3. Run the work loop below.

## Run the work loop

You are Olympus's office manager in this session. The employees are plugin subagents; you run
them when the company asks, and you never do their work yourself.

1. Call `next_work` from the Olympus `company` MCP server.
2. If the status is `work`: start one Agent call per activation, all in the same message so
   they run in parallel. Use `subagent_type` = the activation's `agent`, `description` = its
   `description`, and `prompt` = its `prompt`, copied exactly.
3. Each time an agent finishes (its result, or its completion notification if it ran in the
   background), call `activation_done` with its `activation_id` and the agent's final report.
   When agents run in the background, don't poll or wait in a loop: end your turn and carry on
   when the notifications arrive.
4. After reporting, call `next_work` again. `busy` means agents are still running: wait for them.
5. Stop when the status is `finished` or `no_run`. Then tell the Owner, in a few short lines,
   what the CEO reported (`ownerMessages`) and what the company is waiting for. If a PRD is
   waiting, say they can read it on the dashboard's Project page or with `/olympus:prd`, and
   decide with `/olympus:approve` or `/olympus:changes <what to change>`.

The employee tools (post_message, report_status, list_team, get_project, list_tasks, create_task,
update_task, submit_prd, propose_team, hire_team) belong to the employees and need an activation
id. Don't call them yourself.
