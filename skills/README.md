# wilmai skills

This folder contains skills compatible with the **Skills CLI** (vercel-labs/skills).

## Install with Skills CLI
```bash
npx skills add aikarjal/wilmai
```

## Install as a plugin (skills + MCP server)
For just the Wilma tools in Claude Code, one command is simpler: `claude mcp add --scope user wilma -- npx -y @wilm-ai/wilma-cli@2 mcp`.

This folder is also the `wilma` plugin for Claude Code and Codex, with both skills included:
```bash
# Claude Code
/plugin marketplace add aikarjal/wilmai
/plugin install wilma@wilmai

# Codex
codex plugin marketplace add aikarjal/wilmai
codex plugin add wilma@wilmai
```

## Available skills
- `wilma` — Read schedules, homework, exams (with start times), grades and the gradebook, lesson notes and absences, messages with replies, bulletins and their attachments, and printouts, through the WilmAI MCP tools or the `wilma` CLI (2.0+).
- `wilma-triage` — Daily triage: one `summary --since <last run>` call for every child, filter for actionable items, sync exams to the family calendar (any calendar tool), report to chat.
