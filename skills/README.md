# wilmai skills

This folder contains skills compatible with the **Skills CLI** (vercel-labs/skills).

## Install with Skills CLI
```bash
npx skills add aikarjal/wilmai
```

## Install as a plugin (skills + MCP server)
This folder is also the `wilma` plugin for Claude Code and Codex:
```bash
# Claude Code
/plugin marketplace add aikarjal/wilmai
/plugin install wilma@wilmai

# Codex
codex plugin marketplace add aikarjal/wilmai
codex plugin add wilma@wilmai
```

## Available skills
- `wilma` — Fetch schedules, homework, exams, grades, lesson notes, messages, and news through the WilmAI MCP tools or the Wilma CLI.
- `wilma-triage` — Daily triage workflow: filter actionable items, sync exams to the family calendar (any calendar tool), report to chat.
