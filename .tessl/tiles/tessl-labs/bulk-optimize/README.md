# Bulk Optimize

A skill for bulk optimization of external skills for PR contributions (Alan's tool).

## Purpose

This skill is designed for **contributors** (like Alan) who:
- Improve multiple skills in external/OSS repositories
- Create pull requests with skill improvements
- Need to avoid common PR rejection patterns
- Want to validate changes before submitting

**NOT for**: Personal skill improvement (use `skill-optimizer` instead)

## Status: Ready for Testing ✅

**Current Score**: 93% (Description: 100%, Content: 85%)

## Key Features

### Safety Checks
- ✅ Auto-generated file detection (avoid googleworkspace scenario)
- ✅ Merge conflict warnings (recent path migrations)
- ✅ Domain expertise preservation (avoid coreyhaines31 scenario)
- ✅ Repository pattern analysis

### Validation
- ✅ Code syntax validation (catch googleworkspace flag errors)
- ✅ Command-line syntax validation
- ✅ File reference validation
- ✅ Post-change score verification

### PR Guidance
- ✅ Recommends one-skill-per-PR when appropriate
- ✅ Risk assessment for high-scoring skills
- ✅ Suggests opening issues first for unsolicited changes
- ✅ Explains rubric for transparency

## Files

- `skills/bulk-optimize/SKILL.md` - Main skill (93% score)
- `skills/bulk-optimize/RUBRIC.md` - Evaluation rubric reference
- `COMPARISON.md` - Analysis vs endpoint approach
- `README.md` - This file

## Usage

For bulk PR work on external repos:

```bash
# Clone/fork external repo
gh repo fork owner/repo --clone

# In Claude Code with bulk-optimize installed
"Use bulk-optimize to improve skills in this repo"
```

The skill will:
1. Run safety checks (auto-generated, conflicts)
2. Analyze all skills
3. Recommend scope (one-skill vs batch)
4. Validate improvements
5. Guide PR creation

## See Also

- **skill-optimizer**: For personal skill improvement (simpler, user-focused)
- **auto-p-o**: Original bash script this replaces
