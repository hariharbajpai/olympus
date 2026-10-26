---
name: start
description: Start Olympus (background daemon plus live dashboard) and open the dashboard in the browser. Use when the Owner asks to start, boot or open Olympus or its dashboard.
allowed-tools: Bash(node:*)
---

# Start Olympus

Run this command and wait for it to finish:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/olympus.mjs" start
```

Then tell the Owner, in a few short lines:

1. Whether the company is running (started now or already running).
2. The full dashboard link the command printed. Give the whole link: it carries their access token.
3. That they can give the CEO work with `/olympus:brief <what to build>`, or from the dashboard.
   The employees run as subagents in this Claude Code session, on its own login.

Don't run any other commands.
