---
name: hire
description: Hire someone into Olympus directly as the Owner, for example a new CEO or HR head, or any other role.
argument-hint: <role> [name]
allowed-tools: mcp__plugin_olympus_company__owner_hire, mcp__plugin_olympus_company__company_status
---

# Hire someone

The Owner's request: $ARGUMENTS

The first word is the role id; anything after it is the person's name (optional). Role ids: ceo,
hr, cto, designer, writer, tech-lead, architect, qa, devops, security, database, data-ml,
frontend, backend-node, backend-python, fullstack. Map plain words to an id ("HR" → hr,
"react developer" → frontend). If the role is unclear, ask.

Call `owner_hire` with `role` and, if given, `name`. Tell the Owner in one line who joined and
who they report to. If a project is running and you hired a leader (CEO, HR, CTO, Tech Lead), say
they can run `/olympus:run` so the new person picks up the work.
