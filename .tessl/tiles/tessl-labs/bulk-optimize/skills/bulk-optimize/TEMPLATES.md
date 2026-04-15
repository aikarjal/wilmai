# Bulk Optimize Templates

## Commit Message Format

```bash
git commit -m "$(cat <<'EOF'
feat: improve <skill-name> skill quality scores

- Add "Use when..." clause with trigger keywords (+15%)
- Add executable code example (+10%)
- Structure workflow into numbered steps (+8%)

Score improvement: 72% → 95%

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
EOF
)"
```

## PR Description Template

```markdown
Hullo 👋 @<maintainer>

I ran your skills through `tessl skill review` and found some targeted
improvements. Here's the before/after:

| Skill | Before | After | Change |
|-------|--------|-------|--------|
| <skill-name> | 72% | 95% | +23% |

<details>
<summary>Changes made</summary>

- Added "Use when..." clause with natural trigger keywords
- Replaced abstract advice with executable code example
- Structured workflow into numbered validation steps

</details>

Honest disclosure — I work at @tesslio where we build tooling around
skills like these. Not a pitch - just saw room for improvement and
wanted to contribute.

If you want to run reviews yourself, just `npm install @tessl/cli`
then run `tessl skill review path/to/your/SKILL.md`.

Thanks in advance 🙏
```

## Display Before Creating PR

```
Ready to create PR:

Branch: improve/<skill-name>
Commit: feat: improve <skill-name> skill quality scores
Files: 1 changed (+15 -8)

PR will be created to: <upstream-repo>

Review changes? [Show diff / Create PR / Cancel]
```

## Best Practices from Successful PRs

✅ **Concrete workflows** - Numbered steps with validation checkpoints
✅ **Executable code** - Real, runnable examples (not pseudocode)
✅ **Token efficiency** - Remove explanations of known concepts
✅ **Progressive disclosure** - Link to REFERENCE.md vs inlining details
✅ **One-skill-per-PR** - Easier review, higher acceptance rate

## Past PR Rejections to Avoid

| PR | Issue | Lesson |
|----|-------|--------|
| googleworkspace #320 | Invalid command flags | Validate all command syntax |
| coreyhaines31 #65 | Bundled 15+ skills | One skill per PR for easier review |
| JimLiu #53 | Changed high-scoring skill | Don't touch 90%+ skills without invitation |
| Various | Auto-generated files | Always grep for "auto-generated" markers |
