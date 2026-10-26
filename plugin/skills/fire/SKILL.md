---
name: fire
description: Fire someone from Olympus as the Owner, with a reason.
argument-hint: <name or id> [reason]
allowed-tools: mcp__plugin_olympus_company__owner_fire, mcp__plugin_olympus_company__company_status
---

# Fire someone

The Owner's request: $ARGUMENTS

Work out who (a name like "Meera" or an id like "hr") and the reason (the rest; use "Owner
decision" if none). If it's ambiguous, call `company_status` and ask. Then call `owner_fire`
with `employee` and `reason`, and tell the Owner in one line what happened, including any of
their tasks that went back to the board.
