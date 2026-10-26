---
name: prd
description: Show the latest Olympus PRD and its status, so the Owner can approve it or ask for changes.
allowed-tools: mcp__plugin_olympus_company__get_prd
---

# Show the PRD

Call `get_prd` and show the Owner the PRD: the version, title and status first, then the full
Markdown as it is. End with one line: approve with `/olympus:approve` (optionally with a note),
or ask for changes with `/olympus:changes <what to change>`. The dashboard's Project page has
the same buttons.
