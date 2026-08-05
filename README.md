# formtransform

One library to transform surveys between the standards of the CDL survey
ecosystem — **XLSForm** (Kobo Toolbox), **LimeSurvey TSV**, and **DDI
Codebook** — built on a canonical survey type registry (`registry/`) that
defines exactly what is supported and how the standards map onto each other.
Every other artifact this repo publishes — the JS library, the CLI, the
Schematron rules and worker image, the Claude Code skill, the spec site — is
generated from or driven by that registry.

Transformations are best-effort: where a target standard cannot express
something, the transformation either fails loudly (unregistered types) or
reports the loss (per-type `roundTripSafe` / `lossless` flags in the
registry).

## The registry is the source of truth

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
  `src/generated/`, `skills/cdl-survey-types/`, `ddi-validation/ddi_custom_rules.sch`,
  or any `registry/entities/<slug>/docs.md` by hand is pointless — the next
  `uv run codegen` overwrites it.
- **`codegen` is the only writer** of those artifacts, and it validates the
  registry first, so an invalid registry cannot produce artifacts at all.
- **Downstream repos inherit the registry transitively.** formtransform-app and
  qwacback depend on `@correlaid/formtransform` (built from `src/`, which embeds
  `src/generated/`) and on the worker image (which bakes in the generated
  Schematron); formulaid depends on the generated skill. None of them carry
  their own type list — adding a question type here is what makes it exist for
  all of them.

### Artifacts derived from it

| Artifact | Where | Registry dependency | Consumed by |
|---|---|---|---|
| **Canonical survey type registry** — hand-authored JSON-LD + vocabulary CSVs + per-entity fixtures | `registry/` | *is* the source | everything below |
| **`formtransform` codegen** — Python package (`uv run codegen`) that validates the registry and emits every generated artifact below | `codegen/`, `[project.scripts]` in `pyproject.toml` | reads + validates it | this repo's build; anything vendoring the registry |
| **`@correlaid/formtransform`** — TypeScript library + `formtransform` CLI (`dist/`, `bin` entry) | installed straight from GitHub (`github:CorrelAid/formtransform`), built from this repo's `src/` on install | compiles in generated `src/generated/` (`TypeMappings.ts`, `DdiMappings.ts`, `Appearances.ts`, `conventions.json`) | formtransform-app, qwacback, direct CLI use |
| **Schematron validation worker image** — Java NATS service with the DDI 2.5 XSDs + generated CDL Schematron rules baked in | `ghcr.io/correlaid/schematron-worker`, built from `workers/schematron-worker/` by `.github/workflows/worker-image.yml` | bakes in generated `ddi-validation/ddi_custom_rules.sch` | qwacback (runs the image, does not build it); this repo's pytest validation suite via its CLI mode |
| **`cdl-survey-types` skill** — self-contained Claude Code sub-skill (`SKILL.md` + `references/`), generated from the registry | `skills/cdl-survey-types/` | fully generated | formulaid's `generating-xlsforms` skill, which owns the workflow and includes this as the type reference |
| **Spec site** — Vite + Svelte rendering of the registry, incl. the conceptual model | `docs/`, deployed to GitHub Pages by `.github/workflows/docs.yml` | renders the registry directly | humans |

Only `registry/`, `src/` (minus `src/generated/`), `codegen/`, `workers/` and
`docs/` are hand-written. Everything else is generated: edit the registry
sources, re-run `uv run codegen`.

## Standards

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
recover a select's authored `list_name` or tell `integer` from `decimal` (see
[`src/pipelines/lstsv2xlsform/README.md`](src/pipelines/lstsv2xlsform/README.md)).

**DDI is the terminus:** there is no `ddi2xlsform` or `ddi2lstsv`, by design. A
codebook describes a *dataset*, not an *instrument* — it carries no relevance,
constraint, required, default or appearance (DDI 2.5 has no machine-readable
expression syntax at all), so reversing it would emit a survey that looks right
and behaves wrongly. [`src/pipelines/README.md`](src/pipelines/README.md) has the
full reasoning and what a legitimate skeleton generator would look like instead.

## Layout

- **`registry/`** — all hand-authored registry source lives here.
  `codegen.load_registry()` aggregates it into one `@id`-keyed graph (duplicate
  `@id` across files is a hard error):
  - **`registry/root.jsonld`** — the root graph: structural types
    (`begin_group`/`end_group`), fixtureless types (`select_*_from_file`),
    appearances, vocabularies.
  - **`registry/schema.jsonld`** — the `meta:schema` node: class declarations +
    the field rules `codegen` enforces at load time. Every field carries a
    `consumedBy` array naming the build outputs that read it (see
    `consumedByLegend`); tokens are `ls-transformer`, `ddi-emitter`,
    `schematron`, `conventions`, `examples`, `validation`, or `docs` (= no
    runtime effect). `_validate_consumed_by()` asserts every field is classified
    with a valid token.
  - **`registry/conventions/<slug>.jsonld`** — one file per global convention
    (and the XLSForm column map). A convention describes a *mechanism*, never an
    inventory: the type references in its rule (`appliesTo`) are checked against
    the registry by `_validate_convention_refs()`, but conventions deliberately
    do not enumerate the instances they govern (see `registry/vocab/`).
  - **`registry/vocab/<name>.csv`** — options for each controlled vocabulary used
    by `select_*_from_file`, under a `code,label` header. **Vocabularies are
    open-ended.** To add one, drop in the CSV and add a `"@type": "Vocabulary"` node
    (`xlsformFilename`, `ddiVocab`, `vocabURI`, `standard`, `skos:prefLabel`) —
    nothing else. Every consumer (the TS emitters, the generated skill docs,
    the docker round-trip test) discovers vocabularies by filtering
    `@type == "Vocabulary"`, so no code, convention or emitter needs editing.
    `_validate_vocab_files()` asserts each declared `xlsformFilename` exists on
    disk. `iso_3166_1` is one example, not a special case.
  - **`registry/entities/<slug>/`** — one flat, self-contained folder per
    authored entity that carries a worked example — a `QuestionType` (its own
    default example), a `QuestionTypeVariant`, or a `Composite`. Holds
    `definition.jsonld` (the single source) alongside its fixtures
    (`xlsform.json` input + blessed `ddi.xml`/`tsv.tsv` snapshots) and the
    codegen-written `docs.md`/`xlsform.xlsx`. Naming follows the XLSForm type
    string; a variant slug is `<base>` plus its active presentation modifiers in
    alphabetical order (`long_list` before `other`, e.g.
    `select_one_long_list_other`) — codegen validates slug ↔ flags.
- **`src/`** — the TypeScript library (`@correlaid/formtransform`), split into
  **format modules** (what a standard *is*) and **pipelines** (one per supported
  direction). A format module never imports another one; every cross-format
  concern lives in a pipeline.
  - **`src/xlsform/`** — load a workbook (`loader.ts`), parse its sheets
    (`parser.ts`), check it against the supported subset (`validate.ts`),
    sanitize names/codes (`sanitize.ts`).
  - **`src/lstsv/`** — read (`parser.ts`) and write (`serialize.ts`) LimeSurvey
    structure TSV, plus the reverse-subset check (`validate.ts`).
  - **`src/ddi/`** — the DDI-Codebook 2.5 emitter (`codebook.ts`, `xml.ts`,
    `notes.ts`) over the canonical `Variable[]` model (`types.ts`). This model is
    the hub: both DDI pipelines produce `Variable[]`, then one writer emits the
    XML.
  - **`src/pipelines/<source>2<target>/`** — `xlsform2lstsv/` (the converter +
    the XPath → Expression Manager transpiler), `xlsform2ddi/`, `lstsv2ddi/`,
    `lstsv2xlsform/` (which carries its own README documenting every known
    loss).
  - **`src/generated/`** holds registry-derived artifacts written by codegen;
    `src/config/`, `src/utils/`, `src/types/` are shared.
- **`codegen/`** (Python package; run `uv run codegen` or `python -m codegen`) — validates the registry, then emits generated artifacts:
  - `src/generated/` — `TypeMappings.ts`, `DdiMappings.ts`, `Appearances.ts`,
    `conventions.json` (consumed by the library)
  - `registry/entities/<slug>/` — `docs.md` + `xlsform.xlsx` per entity
  - `skills/cdl-survey-types/` — the generated sub-skill
  - `ddi-validation/ddi_custom_rules.sch` — the CDL Schematron rules
  - `screenshots/` — question-type previews (opt-in, `--screenshots`)
- **`tests/`** — everything that isn't a TypeScript unit test, split by subject:
  `tests/validation/` (pytest: committed DDI snapshots vs XSD + CDL Schematron,
  XLSForm fixtures vs the pyxform oracle), `tests/live/` (pytest, docker: real
  survey engines — import, respond, read the stored data back), and
  `tests/fixtures/surveys/` (hand-authored multi-question surveys shared by both).
  The library's own transformation tests are vitest under `src/test/`
  (`unit` / `integration` / `contract` projects). See
  [`tests/README.md`](tests/README.md).
- **`ddi-validation/`** — DDI 2.5 XSDs + the CDL Schematron rules. `ddi_custom_rules.sch`
  is **generated** by `codegen` from the registry (type DDI signatures, varGrp
  types, and the Or-Other convention) — edit the registry sources and re-run
  codegen, never the `.sch` by hand.
- **`workers/schematron-worker/`** — Java NATS service validating DDI against
  those schemas. Published as a prebuilt image
  (`ghcr.io/correlaid/schematron-worker`) by `.github/workflows/worker-image.yml`;
  downstream qwacback runs the image rather than building it.
- **`docs/`** — Vite + Svelte spec site rendering the registry (GitHub
  Pages). The conceptual model (layers, elements, question anatomy) is
  documented there.

## CLI

The library ships a `formtransform` CLI (`dist/cli.js`, exposed via the
`bin` entry after `npm run build`).

```sh
# Check an XLSForm against the supported subset (see below)
formtransform validate survey.xlsx

# XLSForm (.xlsx) → LimeSurvey structure TSV
formtransform xlsform2lstsv survey.xlsx -o survey.tsv   # or omit -o for stdout

# XLSForm (.xlsx) → DDI-Codebook 2.5 XML
formtransform xlsform2ddi survey.xlsx -o survey.xml

# LimeSurvey structure TSV → DDI-Codebook 2.5 XML (reverse path)
formtransform lstsv2ddi survey.tsv -o survey.xml

formtransform <command> --help                          # per-command options
```

The transform commands read the workbook and route through the canonical
model. `xlsform2lstsv` options mirror `ConversionConfig` (`--no-markdown`,
`--no-welcome-note`, `--no-end-note`, `--no-other-pattern`, `--show-no-answer`,
`--title`, `--language`); `xlsform2ddi` / `lstsv2ddi` take `--title`,
`--dataset-filename`, `--prod-date`. The transform commands accept
`--skip-validation` and default to stdout.

## Supported XLSForm subset

formtransform consumes a **subset** of XLSForm, and layers extra rules on top
so the XLSForm → LimeSurvey → DDI round-trip is **lossless** (every registry
example reproduces its committed DDI byte-for-byte). The rules are
registry-defined, not hardcoded:

| Constraint | Source | Enforced by |
| --- | --- | --- |
| Only **registered** question types (`select_one`, `integer`, …) | `TYPE_MAPPINGS` (`registry/root.jsonld`) | error |
| Only **allowlisted appearances**, valid for the type | `APPEARANCES` | warning (ignored) |
| Field names: `^[a-zA-Z0-9]+$`, ≤ 20 chars, unique | `conventions.sanitization.name` | error |
| Answer codes: `^[a-zA-Z0-9]+$`, ≤ 5 chars (LimeSurvey `varchar(5)`) | `conventions.sanitization.choiceCode` | error |
| `<base>_other` companion for the semi-open "other" pattern | `convention:other` | exempt (underscore allowed) |

Names/codes are **verified, not silently sanitized** — a form that breaks the
rules is rejected (default-on; pass `skipValidation` / `--skip-validation` to
fall back to the lenient sanitizer, which mangles names and breaks the
round-trip). Run `formtransform validate <survey.xlsx>` to see every finding at
once (errors block a lossless transform; warnings are dropped by the
converter). Programmatically: `XLSValidator.validateSubset(survey, choices)`
returns the same `SubsetViolation[]`.

The reverse path (`lstsv2ddi`) mirrors this: it rejects a LimeSurvey TSV that
uses a question type outside the transformable subset (the LS codes the
registry maps, plus `F`/`T`), rather than silently mis-typing it. Bypass with
`skipValidation`; inspect via `validateLstsvSubset(rows)`. DDI-irrelevant
LimeSurvey features (relevance, validation, conditions, attributes) are
intentionally not checked — the DDI drops them anyway.

## Working on it

```sh
uv run codegen                 # validate registry + regenerate artifacts
npm run build                  # build the library
npm test                       # vitest: unit + integration + contract
npm run test:unit              # one project (also :integration, :contract)
uv run pytest                  # python: validation suites (live tests excluded)
npm run test:live              # docker: real LimeSurvey (import + respond)
npm run test:all               # all of the above
npm run bless                  # accept new fixture snapshots (review diff!)
cd docs && npm run dev         # spec site
```

The registry is an **allowlist**: an XLSForm type that is not registered
aborts the transformation (`convention:unregisteredRows`); device/session
metadata rows (`start`, `end`, `today`, …) are skipped silently. Adding or
changing a type means editing the registry and its fixture, re-running
codegen, and passing both test suites.

## Decisions

- yeet concept creation/it being mandatory as we have to manually add
  - maybe add input possibility to transform app
