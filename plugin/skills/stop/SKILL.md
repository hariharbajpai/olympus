---
name: stop
description: Stop the Olympus company daemon. Running agents are stopped and the dashboard goes offline.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# Stop Olympus

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/olympus.mjs" stop
```

Tell the Owner in one line whether the daemon stopped.
