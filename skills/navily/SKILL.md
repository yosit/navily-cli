---
name: navily
description: "Use when the user asks about Navily — query data, manage resources, or interact with the Navily platform. Provides CLI commands for all Navily API operations."
---

# Navily CLI Skill

Queries and manages Navily data via the `navily` CLI.

## Setup

Credentials stored in psst `navily` env profile:

```bash
psst --global run --env navily 'navily <command>'
```

## Commands

### auth
Verify authentication and show user info.
```
navily auth
```

> TODO: Add commands here as you implement them during Phase 7.

## Output Formats
- `--format toon` (default) — human-readable
- `--format json` — machine-readable JSON
