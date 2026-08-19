# formtransform

One library to transform surveys between the standards of the CDL survey
ecosystem — **XLSForm** (Kobo Toolbox), **LimeSurvey TSV**, and **DDI
Codebook** — built on a canonical survey type registry (`registry/`) that
defines exactly what is supported and how the standards map onto each other.

## What this repo ships

Four things other projects consume — all derived from the one registry:

| Artifact | Where | Consumed by |
|---|---|---|
| **`@correlaid/formtransform`** — TypeScript library + `formtransform` CLI | npm package (`github:CorrelAid/formtransform`) | formtransform-app, qwacback, direct CLI use |
| **schematron-worker image** — Java NATS service validating DDI against the XSDs + CDL rules, baked in | `ghcr.io/correlaid/schematron-worker:<version>`, built from `workers/schematron-worker/` | qwacback (runs the image, does not build it) |
| **DDI validation assets** — DDI 2.5 XSDs + the codegen-written `ddi_custom_rules.sch` | `ddi-validation/{xsd,schematron}/` | qwacback, synced via its `.registry-version` pin |
| **`cdl-survey-types` skill** — self-contained Agent Skill (`SKILL.md` + `references/`), generated from the registry; portable to any agent runtime that reads the format  | `skills/cdl-survey-types/` | formulaid's `generating-xlsforms` skill, which owns the workflow and includes this as the type reference |

Everything else here (`docs/` spec site, `screenshots/`, tests, fixtures) is
in-repo only.

## Installation

### As a library

```bash
npm install github:CorrelAid/formtransform
```

### As a CLI tool

```bash
npx github:CorrelAid/formtransform --help
```

## Quick Start

### TypeScript/JavaScript

```typescript
import { XLSFormToTSVConverter } from '@correlaid/formtransform';

const converter = new XLSFormToTSVConverter();
const tsv = await converter.convert(survey, choices, settings);
```

A DDI codebook and the data file it describes come from the same variable list,
so the CSV headers match the XML `<var name="">` elements one-to-one:

```typescript
import {
  buildDdiXml,
  buildDataCsv,
  extractVariables,
  choicesByListFromRows,
} from '@correlaid/formtransform';

const xml = buildDdiXml(survey, choices, { settings: settings[0], submissions });
const csv = buildDataCsv(
  extractVariables(survey, choicesByListFromRows(choices)),
  submissions,
);
```

### Command Line

```bash
# Convert XLSForm to LimeSurvey TSV
formtransform xlsform2lstsv survey.xlsx -o survey.tsv

# Convert to DDI Codebook
formtransform xlsform2ddi survey.xlsx -o codebook.xml

# Convert from LimeSurvey TSV back to XLSForm
formtransform lstsv2xlsform survey.tsv -o recovered.xlsx
```

## The Registry is the Source of Truth

**`registry/` is the single source every other artifact in this repo derives
from.** It is hand-authored (JSON-LD + vocabulary CSVs + per-entity fixtures);
nothing else here defines what a question type is, how it maps between
standards, or what is allowed. Every downstream artifact — the TypeScript
library and its CLI, the generated Schematron rules and the worker image that
ships them, the Claude Code skill, the spec site, the test fixtures — is either
generated from the registry by `codegen` or reads registry-derived data at
runtime.

Concretely, this means:

- **A behaviour change starts in `registry/`, never downstream.** Editing
  generated files by hand is pointless — the next `uv run codegen` overwrites them.
- **`codegen` is the only writer** of those artifacts, and it validates the
  registry first, so an invalid registry cannot produce artifacts at all.
- **Downstream repos inherit the registry transitively.** formtransform-app and
  qwacback depend on `@correlaid/formtransform` and on the worker image;
  formulaid depends on the generated skill. None of them carry their own type
  list — adding a question type here is what makes it exist for all of them.

## Supported Standards

Three standards, each owned by a different tool and built for a different job.
They disagree on basic terms — what a question is, what its parts are — so the
library routes every transformation through the canonical registry, which
records how each maps onto it.

| Standard | Role | Type system |
|---|---|---|
| [XLSForm](https://xlsform.org) (Kobo/ODK) | **Authoring** — surveys are written here | type strings (`select_one`, `integer`) |
| [LimeSurvey TSV](https://www.limesurvey.org/manual/Tab_Separated_Value_survey_structure) | **Deployment** — recreate the survey in LimeSurvey | type codes (`L`, `M`, `F`, `N`) |
| [DDI Codebook 2.5](https://ddialliance.org/Specification/DDI-Codebook/2.5/) | **Documentation** — describe the resulting dataset | interval class + response domains (`category`, `multiple`) |

**Supported directions:** four, one per module under `src/pipelines/` —
`xlsform2lstsv` (deploy the survey), `xlsform2ddi` (document the dataset),
`lstsv2ddi` and `lstsv2xlsform` (the reverse paths). All are lossy for some
types: plain/nested groups flatten, choice codes over 5 chars truncate,
`select_multiple` becomes N binary variables, and the reverse paths cannot
recover a select's authored `list_name` or tell `integer` from `decimal`.

**DDI is the terminus:** there is no `ddi2xlsform` or `ddi2lstsv`, by design. A
codebook describes a *dataset*, not an *instrument* — it carries no relevance,
constraint, required, default or appearance, so reversing it would emit a survey
that looks right and behaves wrongly.

## Supported XLSForm Subset

Not everything XLSForm allows is registered (supported). The library strictly
validates against this subset, rejecting:

- **Unregistered types** (no LimeSurvey equivalent — `image`, `audio`, `geopoint`, etc.)
- **Unregistered appearances** (warn + ignore)
- **Out-of-subset names** — identifiers must be `[a-z][a-z0-9_]*` under 17 chars,
  codes under 6, groups under 21
- **Deep nesting** — max 3 levels (`group/group/question`)
- **Missing `list_name`** — selects require explicit lists
- **Reserved words** — `relevance`, `validation`, `text`, etc. (LimeSurvey internals)

LimeSurvey's reverse-subset check (`lstsv2xlsform`) is narrower — no arrays,
no ranking, no numeric/date expressions.

## Development

```bash
# Install dependencies
npm install
uv sync

# Run tests
npm test           # TypeScript tests
uv run pytest      # Python tests
npm run test:live  # Docker integration tests

# Generate artifacts from registry
uv run codegen

# Bless snapshots after registry changes
npm run bless
```

## Documentation

- [Architecture](ARCHITECTURE.md) — Technical architecture and internal structure
- [formtransform-app handover](HANDOVER_FORMTRANSFORM_APP.md) — plan for moving the
  frontend app onto this library (issue-by-issue)
- [qwac handover](HANDOVER_QWAC.md) — plan for aligning the question-bank browser
  with this registry
- [formulaid handover](HANDOVER_FORMULAID.md) — plan for aligning the survey
  generator and its Claude skill with this registry
- [cdl-wp-eins handover](HANDOVER_CDL_WP_EINS.md) — plan for the website content
  that advertises these tools and feeds agent-readable XLSForm docs
- [Claude Code Integration](CLAUDE.md) — Claude-specific features and skills
- [Pipeline Documentation](src/pipelines/README.md) — Transformation pipeline details
- [Test Documentation](tests/README.md) — Test structure and running tests

## License

MIT
