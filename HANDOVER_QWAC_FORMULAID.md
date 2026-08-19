# Handover: aligning qwac and formulaid with this registry

Audience: whoever (person or agent) picks up
[`CorrelAid/qwac`](https://github.com/CorrelAid/qwac) or
[`CorrelAid/formulaid`](https://github.com/CorrelAid/formulaid) next. This
document is the plan; the work is split into issues in those repos, linked below.
Each issue stands on its own — an agent should be able to act on one without
reading the others.

Companion document:
[`HANDOVER_FORMTRANSFORM_APP.md`](HANDOVER_FORMTRANSFORM_APP.md), which covers the
frontend converter app. The situation there was a *dependency* problem (two
conversion engines, one library to replace them). Here it is a *drift* problem:
neither repo runs a competing converter, but both carry hand-maintained copies of
knowledge this registry owns.

## Which repo consumes what

| Repo | Relationship to this registry today | What should change |
|---|---|---|
| **qwac** (SvelteKit SPA, question-bank browser) | No dependency at all. Renders qwacback data, whose types come from here, using its own hardcoded type vocabulary | Import the type catalogue instead of hardcoding it; explain what its DDI validation actually checks |
| **formulaid** (SvelteKit app + `generating-xlsforms` Claude skill) | None in code. The skill teaches XLSForm from `umfragen.civic-data.de` llm.txt; the app builds workbooks with `xlsx` and never validates them | Bundle the generated `cdl-survey-types` sub-skill; validate generated forms with the library |
| **qwacback** (Go/PocketBase API) | Consumes the schematron-worker image and the DDI validation assets | Already has its own brief — see [qwacback](#qwacback-already-briefed) |

## The shared failure mode

This registry is an **allowlist**. Unregistered question types, unregistered
appearances, over-long identifiers, nesting deeper than three levels and selects
without an explicit `list_name` are *rejected*, not approximated — see
[Supported XLSForm Subset](README.md#supported-xlsform-subset).

Both repos currently describe the survey world in their own words:

- qwac derives human labels from type strings by text surgery
  (`AnswerTypeTag.svelte` strips `_other` / `_long_list`, replaces underscores,
  title-cases), so `select_one` shows as "Select One" rather than the registry's
  own `skos:prefLabel`. Its `question-types/*.svelte` preview components encode
  the type list a second time, with nothing to catch a registry type that has no
  component.
- formulaid's skill ships ~1000 lines of general XLSForm specification —
  `calculation`, "Anhang – Laden großer CSV-Dateien", "Weitere Antwortformate",
  "Nicht empfohlene Antwortformate" — which describes far more than the pipeline
  accepts. A model reading it will confidently produce forms that fail
  conversion, and the failure surfaces in a different repo. Its app also hardcodes
  `QuestionType = 'select_one' | 'select_multiple' | 'text' | 'integer' | 'decimal' | 'date' | 'note'`
  and never checks its output.

Neither is a bug today. Both become wrong the moment a question type is added,
renamed or archived here.

## What this repo can and cannot hand over

Available now, from the package root (`github:CorrelAid/formtransform`):

- `XLSLoader.parseXLSData(data, { skipValidation? })` — parse a workbook;
  validates against the supported subset by default and throws.
- `XLSValidator` + the `SubsetViolation` type — validate and get findings back
  instead of an exception. This is what formulaid needs for a repair loop.
- `XLSFormParser.convertXLSDataToTSV`, `buildDdiXml`, `lstsvToDdiXml`,
  `lstsvToXlsform` — the four supported directions.
- `TYPE_MAPPINGS` — per-type mapping facts: `kind`, `limeSurveyType`,
  `supported`, `requiresListName`, `answerClass`, `dateFormat`.
- `skills/cdl-survey-types/` — the generated sub-skill (`SKILL.md` plus
  `references/question-types.md` and `references/xlsform-syntax.md`), portable to
  any agent runtime. Not part of the npm-format package; fetched from the repo at
  a pinned tag.

**Not available, and this is the constraint that shapes both plans:** there is no
labelled, machine-readable type catalogue. `skos:prefLabel`, `useWhen` and the
variant → base relation exist in `registry/` and are rendered into the generated
skill and the docs site, but nothing exports them as data — and the published
package sets `"files": ["dist"]`, so `registry/` never reaches a consumer's
`node_modules`. `src/generated/Appearances.ts` (including the `carriesData` flag a
preview UI wants) is generated but not re-exported from `src/index.ts`.

Both tracking issues below ask for the same thing: an addition to
`codegen/emit_ts.py` emitting a `QUESTION_TYPES` record with labels, exported from
the package root. It is derived data — every field is already in the registry — so
it is an emitter change, not a registry change. **One upstream issue can serve
both repos**; whoever files first should link the other.

## The issues

### qwac

| # | Issue | When |
|---|---|---|
| 1 | [#9 Centralise question-type knowledge in one module](https://github.com/CorrelAid/qwac/issues/9) | first; no new dependency |
| 2 | [#10 Import the type catalogue from `@correlaid/formtransform`](https://github.com/CorrelAid/qwac/issues/10) | after #9 **and** after the upstream catalogue ships |
| 3 | [#11 Upstream gaps: labelled catalogue, `APPEARANCES` export](https://github.com/CorrelAid/qwac/issues/11) | now; tracking only, blocks #10 |
| — | [#12 Upload page: show why DDI validation failed](https://github.com/CorrelAid/qwac/issues/12) | any time; relates to existing #8 |

Issue #9 is deliberately doable with no dependency: it collapses the scattered type
knowledge into one `src/lib/questionTypes.ts` whose contents #10 then swaps for
the imported catalogue in a single edit. The labels for #9 are copied from
`skills/cdl-survey-types/references/question-types.md` in this repo — the `##`
headings carry the registry's own `prefLabel`.

Issue #12 is the qwac counterpart of the app's scope notice. Its upload page POSTs DDI
XML to qwacback's `/api/validate`, which validates against the DDI 2.5 XSDs **and**
the CDL Schematron rules generated here — so a rejection can mean "not valid DDI"
or "valid DDI that is not CDL-shaped", and the page currently says neither.
`src/lib/validation.ts`'s `safeErrorMessage()` throws the detail away on purpose,
which is the right default everywhere except the screen whose entire job is
explaining what is wrong with a file.

### formulaid

| # | Issue | When |
|---|---|---|
| 1 | [#9 Bundle the generated `cdl-survey-types` sub-skill into the skill build](https://github.com/CorrelAid/formulaid/issues/9) | first |
| 2 | [#10 Strip the generic XLSForm spec from the skill references](https://github.com/CorrelAid/formulaid/issues/10) | after #9 — never before |
| 3 | [#11 Validate generated workbooks with the library before download](https://github.com/CorrelAid/formulaid/issues/11) | any time; app-side, independent of the skill work |
| — | [#12 Upstream gaps: labelled catalogue, sub-skill release asset](https://github.com/CorrelAid/formulaid/issues/12) | now; tracking only |

Order matters between #9 and #10: #10 removes the reference content that #9
replaces, and doing it the other way round leaves the skill with no type
reference at all for however long the gap lasts.

`scripts/build_skill.sh` already fetches remote content (llm.txt, qwacback
demographics) into `references/`, so vendoring the sub-skill from a pinned tag
fits the existing shape. The one hard requirement: a failed fetch must fail the
build. A skill shipped without its type reference is worse than a stale one,
because the model silently falls back on generic XLSForm knowledge.

Issue #11 implements existing formulaid issue
[#4](https://github.com/CorrelAid/formulaid/issues/4) ("Let xlsform be validated
and try again with error messages"), which asks whether to add validation to
qwacback or "use some existing package". The package is this library, it runs in
the browser, and it needs no service.

## qwacback (already briefed)

`CorrelAid/qwacback` has its own migration brief, currently untracked at
`REGISTRY_SYNC.md` in that working copy. Its plan still holds — delete the
vendored Go converter, the vendored XSDs/Schematron and the Java worker source;
consume `@correlaid/formtransform` plus `ghcr.io/correlaid/schematron-worker`
pinned to one version — but it was written before this repo was renamed and
restructured, so three details in it are stale:

- the repo is `CorrelAid/formtransform`, not `CorrelAid/survey-type-registry`
- example fixtures live at `registry/entities/<slug>/fixtures/xlsform.json`, not
  `registry/types/<slug>/examples/<variant>/xlsform.json`
- `lstsv2ddi` and `lstsv2xlsform` now exist, which the brief predates

Worth filing as issues in that repo the same way, once someone picks it up.

## Hard rules for whoever does the work

- **Do not modify this repo from a consumer.** Missing capability → open an issue
  here. Both tracking issues (#11 in qwac, #12 in formulaid) exist for exactly
  that.
- **Do not vendor `registry/`.** A copied JSON-LD graph is drift with extra
  steps. If the data is not exported, the fix is an emitter change here.
- **Do not hand-edit generated files.** Everything under
  `skills/cdl-survey-types/` and `src/generated/` carries a "DO NOT EDIT" header
  and is overwritten by the next `uv run codegen`.
- **Do not reimplement subset rules in a consumer.** Call `XLSValidator`. If a
  rule looks wrong, that is a finding for this repo.
- **Pin to tags, not branches.** A registry change should never alter a deployed
  UI or a shipped skill without a commit in the consuming repo.

## Related documents

- [`README.md`](README.md) — what this repo ships and to whom
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — registry → codegen → artifacts
- [`HANDOVER_FORMTRANSFORM_APP.md`](HANDOVER_FORMTRANSFORM_APP.md) — the frontend
  converter app's migration
