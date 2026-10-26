---
name: status
description: Show whether the Olympus company daemon is running, who is working, the current run and its spend. Use when the user asks about Olympus's status.
allowed-tools: Bash(node:*)
---

# Olympus status

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/olympus.mjs" status
```

Summarise the output for the Owner in two or three short lines: running or not, who is doing what, and the spend. Include the dashboard link if it printed one.
