# Architecture

This document describes the technical architecture and internal structure of the formtransform codebase.

## Project Layout

### Registry (`registry/`)

All hand-authored registry source lives here. `codegen.load_registry()` aggregates it into one `@id`-keyed graph (duplicate `@id` across files is a hard error):

- **`registry/root.jsonld`** — the root graph: structural types (`begin_group`/`end_group`), fixtureless types (`select_*_from_file`), appearances, vocabularies.

- **`registry/schema.jsonld`** — the `meta:schema` node: class declarations + the field rules `codegen` enforces at load time. Every field carries a `consumedBy` array naming the build outputs that read it (see `consumedByLegend`); tokens are `ls-transformer`, `ddi-emitter`, `schematron`, `conventions`, `examples`, `validation`, or `docs` (= no runtime effect). `_validate_consumed_by()` asserts every field is classified with a valid token.

- **`registry/conventions/<slug>.jsonld`** — one file per global convention (and the XLSForm column map). A convention describes a *mechanism*, never an inventory: the type references in its rule (`appliesTo`) are checked against the registry by `_validate_convention_refs()`, but conventions deliberately do not enumerate the instances they govern (see `registry/vocab/`).

- **`registry/vocab/<name>.csv`** — options for each controlled vocabulary used by `select_*_from_file`, under a `code,label` header. **Vocabularies are open-ended.** To add one, drop in the CSV and add a `"@type": "Vocabulary"` node (`xlsformFilename`, `ddiVocab`, `vocabURI`, `standard`, `skos:prefLabel`) — nothing else. Every consumer (the TS emitters, the generated skill docs, the docker round-trip test) discovers vocabularies by filtering `@type == "Vocabulary"`, so no code, convention or emitter needs editing. `_validate_vocab_files()` asserts each declared `xlsformFilename` exists on disk. `iso_3166_1` is one example, not a special case.

- **`registry/entities/<slug>/`** — one flat, self-contained folder per authored entity that carries a worked example — a `QuestionType` (its own default example), a `QuestionTypeVariant`, or a `Composite`. Structure:
  - `definition.jsonld` — the single source
  - `fixtures/xlsform.json` — input fixture
  - `generated/` — codegen outputs (docs.md, xlsform.xlsx)
  - `ddi.xml`, `tsv.tsv` — blessed snapshots

### Source Code (`src/`)

The TypeScript library (`@correlaid/formtransform`), split into **format modules** (what a standard *is*) and **pipelines** (one per supported direction). A format module never imports another one; every cross-format concern lives in a pipeline.

#### Format Modules

- **`src/xlsform/`** — load a workbook and parse its sheets (`loader.ts`), check it against the supported subset (`validate.ts`), sanitize names/codes (`sanitize.ts`, `identifiers.ts`), row types (`types.ts`).

- **`src/lstsv/`** — read (`parser.ts`) and write (`serialize.ts`) LimeSurvey structure TSV, plus the reverse-subset check (`validate.ts`).

- **`src/ddi/`** — the DDI-Codebook 2.5 emitter (`codebook.ts`, `xml.ts`, `notes.ts`) over the canonical `Variable[]` model (`types.ts`). This model is the hub: both DDI pipelines produce `Variable[]`, then one writer emits the XML.

- **`src/conventions/`** — one module per registry convention (`other.ts`, `fromFile.ts`, `exclusive.ts`, `grid.ts`, `metadata.ts`). Each reads its values from `src/generated/conventions` and exposes helpers; every format module and pipeline imports them from here. No convention value (suffix, choice code, label, prefix) is written out anywhere else, which `tests/ts/unit/conventionLiterals.test.ts` enforces.

#### Pipelines

- **`src/pipelines/<source>2<target>/`** — One module per supported direction:
  - `xlsform2lstsv/` — the converter + the XPath → Expression Manager transpiler
  - `xlsform2ddi/` — XLSForm to DDI Codebook
  - `lstsv2ddi/` — LimeSurvey TSV to DDI Codebook
  - `lstsv2xlsform/` — reverse conversion (see its README for known losses)

- **`src/generated/`** holds registry-derived artifacts written by codegen
- **`src/config/`, `src/utils/`, `src/types/`** are shared utilities

#### The browser boundary

Everything reachable from **`src/index.ts`** runs in a browser: no filesystem,
no network, no Node built-ins (a `Buffer` type in a signature also accepts an
`ArrayBuffer`). That includes `parseResponses` (`src/responseFile.ts`), so an
app can parse an uploaded Kobo/LimeSurvey export with the same code the CLI
uses. The library ships **no survey-platform API clients**: getting data out of
Kobo or LimeSurvey is the platform's own export step (see
[RESPONSE_DATA.md](RESPONSE_DATA.md)).

Node-only, and never imported by `src/index.ts`: `src/cli.ts` (the
`formtransform` binary), `src/cliShared.ts` (its argument parsing and file
I/O), `src/fileChoices.ts` (loads `select_*_from_file` CSVs from disk) and
`src/generateFixtures.ts`. The registered vocabularies don't need
`fileChoices.ts`: codegen emits their options to
`src/generated/VocabularyOptions.ts`, and the converter inlines them in the
browser too.

### Code Generation (`codegen/`)

Python package (run `uv run codegen` or `python -m codegen`) that validates the registry, then emits generated artifacts:

- `src/generated/` — `TypeMappings.ts`, `DdiMappings.ts`, `Appearances.ts`, `QuestionTypes.ts`, `conventions.ts` (consumed by the library) plus `conventions.json`, the same payload for non-TypeScript consumers. The library imports the `.ts` twin, never the JSON: a runtime JSON import only reaches `dist/` if tsc copies it, and import attributes are not understood by every consumer's bundler. `npm run build` copies the JSON to `dist/generated/` after `tsc`.
- `registry/entities/<slug>/` — `docs.md` + `xlsform.xlsx` per entity
- `skills/cdl-survey-types/` — the generated sub-skill
- `ddi-validation/ddi_custom_rules.sch` — the CDL Schematron rules
- `screenshots/` — question-type previews (opt-in, `--screenshots`)

### Tests (`tests/`)

Everything that isn't a TypeScript unit test, split by subject:

- `tests/validation/` — pytest: committed DDI snapshots vs XSD + CDL Schematron, XLSForm fixtures vs the pyxform oracle
- `tests/live/` — pytest, docker: real survey engines — import, respond, read the stored data back
- `tests/fixtures/surveys/` — hand-authored multi-question surveys shared by both

The library's own transformation tests are vitest under `tests/ts/` (`unit` / `integration` / `contract` projects). See [`tests/README.md`](tests/README.md).

### Supporting Infrastructure

- **`ddi-validation/`** — DDI 2.5 XSDs + the CDL Schematron rules. `ddi_custom_rules.sch` is **generated** by `codegen` from the registry (type DDI signatures, varGrp types, and the Or-Other convention) — edit the registry sources and re-run codegen, never the `.sch` by hand.

- **`workers/schematron-worker/`** — Java NATS service validating DDI against those schemas. Published as a prebuilt image (`ghcr.io/correlaid/schematron-worker`) by `.github/workflows/worker-image.yml`; downstream qwacback runs the image rather than building it.

- **`docs/`** — Vite + Svelte spec site rendering the registry (GitHub Pages). The conceptual model (layers, elements, question anatomy) is documented there.

## Pipeline Architecture

One module per supported direction. A pipeline owns everything cross-format; the format modules it draws on (`src/xlsform/`, `src/lstsv/`, `src/ddi/`) never import each other or a pipeline, and a pipeline never imports a sibling pipeline. Code both sides need lives in `src/conventions/`, `src/ddi/` (the `Variable` hub and its data CSV, `data.ts`), `src/diagnostics.ts` or `src/utils/`. ESLint enforces the rules (`no-restricted-imports`, plus `no-restricted-syntax` for dynamic `import()`); see the boundary block in `eslint.config.js`.

### DDI as the Hub

Both DDI pipelines converge on the same emitter: they produce `Variable[]` (`src/ddi/types.ts`) and hand it to `buildDdiCodebook`. The variable model is the hub, not any one format.

### Why there is no `ddi2xlsform` or `ddi2lstsv`

Deliberate design decision. **DDI is the terminus of the pipeline graph** — it describes a *dataset*, not an *instrument*, so it does not carry the information a survey needs to run.

The canonical `Variable` (`src/ddi/types.ts`) is what survives an emit. Everything that makes a form behave is absent:

- **no `relevant`** — DDI Codebook 2.5 has no machine-readable expression syntax at all, so skip logic is dropped on the way in
- **no `constraint`** — same reason
- **no `required`, `default`, `hint`, per-question `appearance`, `calculation`**

Compare `lstsv2xlsform`, which *is* implemented: a LimeSurvey structure TSV carries `relevance`, `em_validation_q`, `mandatory`, `default` and the `!`/`T` type overrides. It is a form definition in a different dialect, so reversing it is a translation problem. Reversing DDI is not — it is a *reconstruction* problem, and the missing pieces cannot be inferred from a codebook.

## Development Workflow

### Adding a New Question Type

1. Add the type definition to `registry/entities/<type>/definition.jsonld`
2. Create example fixture in `registry/entities/<type>/fixtures/xlsform.json`
3. Run `uv run codegen` to generate TypeScript mappings and documentation
4. Run `npm run bless` to create blessed snapshots
5. Add tests in appropriate test suites

### Adding a New Vocabulary

1. Drop the CSV file in `registry/vocab/<name>.csv` with `code,label` header
2. Add a `"@type": "Vocabulary"` node to `registry/root.jsonld`
3. Run `uv run codegen` to regenerate
4. All consumers automatically discover the new vocabulary

### Modifying the Registry Schema

1. Edit `registry/schema.jsonld` with field definitions
2. Update `consumedBy` arrays to indicate which outputs use each field
3. Run `uv run codegen` to validate and regenerate artifacts
4. Run tests to ensure nothing broke
