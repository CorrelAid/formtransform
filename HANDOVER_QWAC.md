# Handover: aligning qwac (and qwacback) with the formtransform registry

Refreshed 2026-09-24 and being moved to `CorrelAid/qwac` as `HANDOVER.md`;
this copy is deleted once qwac's issues link there. "This repo" /
"this registry" below mean formtransform, and bare paths like `registry/` or
`codegen/emit_ts.py` are formtransform paths.

Audience: whoever (person or agent) picks up
[`CorrelAid/qwac`](https://github.com/CorrelAid/qwac) next — the SvelteKit SPA
that browses the question bank. This document is the plan; the work is split into
issues in that repo, linked below. Each issue stands on its own — an agent should
be able to act on one without reading the others.

Companion document: formulaid's `HANDOVER.md` (the survey generator, which
consumes the same catalogue).

## The problem

qwac has **no dependency on this repo at all**, yet it renders qwacback data whose
question types come from here, and it validates DDI uploads against rules
generated here. It describes the survey world in its own words, and those words
are correct only until a question type is added, renamed or archived in
`registry/`.

Two concrete symptoms:

- **Labels are computed, not looked up.**
  `src/lib/components/AnswerTypeTag.svelte` strips `_other` / `_long_list`,
  replaces underscores with spaces and title-cases the rest. So `select_one`
  renders as "Select One" instead of the registry's own `skos:prefLabel`, and any
  type whose name does not survive that transformation renders wrongly.
- **The type list exists twice.** `src/lib/components/question-types/*.svelte`
  holds one preview component per type (`TextInput`, `IntegerInput`,
  `DecimalInput`, `DateInput`, `DateTimeInput`, `TimeInput`, `SelectOneInput`,
  `SelectMultipleInput`, `LongListInput`), and whatever dispatches between them
  encodes the type set a second time. Nothing catches a registry type that has no
  component — it silently renders as a bare tag.

Separately, the DDI upload page is opaque about what it checks. It POSTs to
qwacback's `/api/validate`, which validates against the DDI-Codebook 2.5 XSDs
**and** the CDL Schematron rules generated from this registry
(`ddi-validation/ddi_custom_rules.sch`), both baked into the
`ghcr.io/correlaid/schematron-worker` image. A rejection therefore means either
"not valid DDI 2.5" or "valid DDI that is not CDL-shaped" — very different
messages for a user, and the page currently gives neither.
`src/lib/validation.ts`'s `safeErrorMessage()` discards backend detail by design,
which is the right default everywhere except the one screen whose whole job is
explaining what is wrong with a file.

This registry is an **allowlist**: unregistered question types, unregistered
appearances, over-long identifiers, nesting deeper than three levels and selects
without an explicit `list_name` are *rejected*, not approximated — see
[Supported XLSForm Subset](https://github.com/CorrelAid/formtransform/blob/main/README.md#supported-xlsform-subset).

## What this repo hands over

Available from the package root (`github:CorrelAid/formtransform`). Everything
exported there is browser-safe: no filesystem, no network.

- **`QUESTION_TYPES`**, the labelled catalogue (formtransform#6). Per type it
  has `label` (from `skos:prefLabel`), `useWhen`, `base` / `bases` for variants
  and composites, and `constraints`. It's emitted `as const`, so
  `keyof typeof QUESTION_TYPES` is a literal union. This is what #9's module
  gets swapped for in #10.
- **`APPEARANCES`**, the appearance allowlist, with the types each is valid for
  and a `carriesData` flag (false for matrix headers), which is what a preview UI
  needs.
- **`TYPE_MAPPINGS`**, per-type mapping facts: `kind`, `limeSurveyType`,
  `supported`, `requiresListName`, `answerClass`, `dateFormat`.
- The conversion directions (`XLSFormParser.convertXLSDataToTSV`,
  `buildDdiXml`, `lstsvToDdiXml`, `lstsvToXlsform`). qwac needs none of them
  today.

**Status as of 2026-09-24:**

- #11 (upstream gaps) is **closed**: both shipped, so #10 is unblocked.
- **Pin `v0.1.0`**, the first release (2026-09-24):
  `github:CorrelAid/formtransform#v0.1.0`. It includes the fix for
  formtransform#23 (browser bundles lost skip logic in XLSForm → TSV
  conversion; qwac doesn't use that).

## The issues

| # | Issue | When |
|---|---|---|
| 1 | [#9 Centralise question-type knowledge in one module](https://github.com/CorrelAid/qwac/issues/9) | first; no new dependency |
| 2 | [#10 Import the type catalogue from `@correlaid/formtransform`](https://github.com/CorrelAid/qwac/issues/10) | after #9; upstream catalogue has shipped |
| 3 | [#11 Upstream gaps: labelled catalogue, `APPEARANCES` export](https://github.com/CorrelAid/qwac/issues/11) | closed: both shipped |
| — | [#12 Upload page: show why DDI validation failed](https://github.com/CorrelAid/qwac/issues/12) | any time; findings are already structured (see below) |

Issue #9 is deliberately doable with no dependency at all: it collapses the
scattered type knowledge into one `src/lib/questionTypes.ts`, whose contents #10
then swaps for the imported catalogue in a single edit. Splitting it this way
means the useful half of the work is not blocked on an upstream release.

Issue #10 also adds the payoff test — when the registry gains a data-carrying
question type that has no preview component, the suite fails and the app gets
told, instead of quietly rendering a bare tag.

## qwacback: what's current

Checked against the qwacback code on 2026-09-24. Two things this plan used to
suggest filing are **already solved**:

- **Go map strings.** qwacback's importer now extracts plain text itself
  (`textAt`, and `#text` paths for elements with attributes), so new imports no
  longer store `map[#text:… -attr:…]`. qwac's `src/lib/ddi.ts` (a parser for
  that format) only matters for records imported before that change. Re-import
  existing studies, then delete `ddi.ts` and its test from qwac. That's qwac
  work, not a qwacback issue.
- **Structured validation findings.** `POST /api/validate` answers
  `400 {"valid": false, "errors": [{"rule", "test", "location", "message"}]}`.
  The schematron-worker sets `rule` to `"xsd"` for schema failures and
  `"schematron"` for CDL rule failures. #12 can group by `rule` directly.

**qwacback's registry sync is not started, and it's no longer blocked.** The brief
is `REGISTRY_SYNC.md`, untracked in the local qwacback checkout. It says to
delete the vendored Go converter (`internal/converter/`), the XSDs (`xml/`),
`schematron/` and the Java worker source (`schematron-worker/`), and to consume
`@correlaid/formtransform` plus `ghcr.io/correlaid/schematron-worker`, both
pinned to one version. The plan holds, but:

- **Unblocked:** `ghcr.io/correlaid/schematron-worker:v0.1.0` is published
  (public, also tagged `0.1.0`, `0.1` and `latest`), built by `worker-image.yml`
  from the `v0.1.0` release. Pin both artifacts to `v0.1.0`.
- **Stale details in the brief:** the repo is `CorrelAid/formtransform`, not
  `survey-type-registry`. Example fixtures live at
  `registry/entities/<slug>/fixtures/xlsform.json`, not
  `registry/types/<slug>/examples/<variant>/xlsform.json`. And `lstsv2ddi` /
  `lstsv2xlsform` now exist, which the brief predates.
- **Coverage handoff:** survey2ddi's qwacback equivalence test is being ported
  into formtransform (formtransform#14). qwacback's own converter tests go
  with the Go converter.

## Hard rules for whoever does the work

- **Do not modify formtransform from qwac or qwacback.** Missing capability →
  open an issue on `CorrelAid/formtransform`.
- **Do not vendor `registry/`.** A copied JSON-LD graph is drift with extra
  steps. If the data is not exported, the fix is an emitter change here.
- **Do not hand-edit generated files.** Everything under `src/generated/` and
  `skills/cdl-survey-types/` carries a "DO NOT EDIT" header and is overwritten by
  the next `uv run codegen`.
- **Pin to tags, never branches.** A
  registry change should never alter a deployed UI without a commit in qwac.
- **Unknown types must still render.** qwacback can hold data the app has not
  been taught about; degrade to a plain tag rather than throwing.

## Related documents

- [formtransform `README.md`](https://github.com/CorrelAid/formtransform/blob/main/README.md) — what the registry repo ships and to whom
- [formtransform `ARCHITECTURE.md`](https://github.com/CorrelAid/formtransform/blob/main/ARCHITECTURE.md) — registry → codegen →
  artifacts, and the browser boundary
