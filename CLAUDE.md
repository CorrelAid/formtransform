# Claude Code Integration

This document describes Claude Code-specific features and integrations in the formtransform project.

## Generated Skills

The project automatically generates Claude Code skills from the registry. These skills provide Claude with structured knowledge about survey types and transformations.

### CDL Survey Types Skill

Location: `skills/cdl-survey-types/`

This skill is **fully generated** from the registry by `codegen`. It provides:
- Complete reference documentation for all question types
- XLSForm syntax examples
- DDI mapping information
- LimeSurvey type correspondences

To regenerate the skill after registry changes:
```bash
uv run codegen
```

### Consuming the Skill

The generated skill is consumed by:
- formulaid's `generating-xlsforms` skill, which owns the workflow and includes this as the type reference
- Direct Claude Code invocations for survey-related questions

## Development with Claude Code

### Commands

The project includes custom commands that can be invoked via Claude Code:
- `/help` — Get help with using Claude Code
- Issue reporting at https://github.com/anthropics/claude-code/issues

### Best Practices

1. **Registry Changes**: When modifying the registry, always run `uv run codegen` to regenerate all artifacts including skills
2. **Test Generation**: Use Claude Code to generate test cases for new question types
3. **Documentation**: Skills are self-documenting from the registry metadata

## Skill Structure

The generated skill includes:

### SKILL.md
Main skill definition with structured documentation of all question types.

### references/
- `question-types.md` — Detailed documentation for each question type
- `xlsform-syntax.md` — XLSForm syntax reference
- Additional reference materials generated from registry

All content is derived from:
- `registry/entities/<type>/definition.jsonld` — Type definitions
- `registry/conventions/` — Formatting and behavior conventions
- `registry/vocab/` — Controlled vocabularies

## Maintenance

The skill generation is part of the regular codegen process. No manual editing of skill files is needed — all changes should be made in the registry sources.