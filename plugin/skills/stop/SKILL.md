---
name: stop
description: Stop the Olympus daemon. The dashboard goes offline; the company’s state is saved.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# Stop Olympus

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/olympus.mjs" stop
```

Tell the Owner in one line whether the daemon stopped.
