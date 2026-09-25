# formtransform

[![AI-Assisted](https://img.shields.io/badge/AI--assisted-Claude%20Code-blueviolet?logo=anthropic&logoColor=white)](./AI_DISCLOSURE.md)

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

Each [release](https://github.com/CorrelAid/formtransform/releases) carries a
prebuilt package. Installing it runs no build step:

```bash
npm install https://github.com/CorrelAid/formtransform/releases/download/v0.1.3/correlaid-formtransform-0.1.3.tgz
```

Installing from git also works, but builds `dist/` on install through the
`prepare` script, which needs TypeScript and install scripts enabled:

```bash
npm install github:CorrelAid/formtransform#v0.1.3
```

Releases also attach `cdl-survey-types-<version>.tar.gz`, the generated
[`skills/cdl-survey-types/`](skills/cdl-survey-types/) sub-skill.

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
so the CSV headers match the XML `<var name="">` elements one-to-one. For the
whole path from a Kobo or LimeSurvey export, see
[RESPONSE_DATA.md](RESPONSE_DATA.md):

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

# ...plus the response-data CSV (flat CSV, `;` or `,`, or a Kobo submissions
# JSON array). Writes data.csv beside codebook.xml and sets <caseQnty>.
formtransform xlsform2ddi survey.xlsx -o codebook.xml --data responses.csv

# Same for LimeSurvey: structure TSV + response export (question-code headings)
formtransform lstsv2ddi survey.tsv -o codebook.xml --data responses.csv

# Convert from LimeSurvey TSV back to XLSForm (emitted as JSON sheets)
formtransform lstsv2xlsform survey.tsv -o recovered.json
```

### Asking the library what exists

Two generated catalogues are part of the public API, for consumers that render or
generate surveys rather than convert them:

```typescript
import { QUESTION_TYPES, APPEARANCES, TYPE_MAPPINGS } from '@correlaid/formtransform';

QUESTION_TYPES.select_one.label;          // "Select One"
QUESTION_TYPES.select_one.useWhen;        // when to reach for this type
QUESTION_TYPES.select_one_other.base;     // "select_one" — a variant of it
QUESTION_TYPES.grid.bases;                // composites span several types
QUESTION_TYPES.select_one.constraints;    // name/choice-code limits
APPEARANCES.label.carriesData;            // false — a matrix header stores no answer
TYPE_MAPPINGS.select_one.limeSurveyType;  // "L" — how it converts
```

`QUESTION_TYPES` is keyed by registry slug and answers *what a row can be*
(label, guidance, variant → base, authoring constraints, metadata rows);
`TYPE_MAPPINGS` answers *how it converts*. Both are generated from `registry/` —
never hardcode a type list or a label in a consumer.

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
- **Out-of-subset names** — field names and answer codes must match
  `^[a-zA-Z0-9]+$` (no underscores, except the `<question>_other` companion),
  names at most 20 characters, codes at most 5. `FieldSanitizer` turns free
  text into conforming names: it transliterates (`ä`→`ae`, `ß`→`ss`), drops
  other diacritics and deletes the rest of the non-alphanumerics
- **Deep nesting** — max 3 levels (`group/group/question`)
- **Unresolvable answer options** — a `select_one`/`select_multiple` needs a
  list name with rows on the choices sheet; a `select_*_from_file` needs a
  registered vocabulary (e.g. `iso_3166_1.csv`) or a CSV passed as
  `fileChoices` (the CLI reads CSVs beside the form)
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

### Releasing

1. Bump `version` in `package.json` in a PR and merge it.
2. Publish a GitHub release tagged `v<version>` on that commit.

Publishing the tag builds the `schematron-worker` image
(`worker-image.yml`). Publishing the release attaches the package tarball and
the skill archive (`release-assets.yml`). That job fails if the tag and
`package.json` disagree, and it never replaces an asset that already exists:
consumers pin the checksums, so a fix ships as a new version.

## Documentation

- [Architecture](ARCHITECTURE.md) — Technical architecture and internal structure
- [Response data](RESPONSE_DATA.md) — Kobo/LimeSurvey export → DDI codebook +
  data CSV (CLI and browser), and reading the codebook back in Python
- [survey2ddi handover](https://github.com/CorrelAid/survey2ddi/blob/main/HANDOVER.md)
  — plan for retiring survey2ddi in favour of this library (lives in survey2ddi)
- [qwac handover](HANDOVER_QWAC.md) — plan for aligning the question-bank browser
  with this registry
- [cdl-wp-eins handover](HANDOVER_CDL_WP_EINS.md) — plan for the website content
  that advertises these tools and feeds agent-readable XLSForm docs
- [Claude Code Integration](CLAUDE.md) — Claude-specific features and skills
- [Pipeline Documentation](src/pipelines/README.md) — Transformation pipeline details
- [Test Documentation](tests/README.md) — Test structure and running tests

## AI Disclosure

See [AI_DISCLOSURE.md](./AI_DISCLOSURE.md).

## License

MIT
