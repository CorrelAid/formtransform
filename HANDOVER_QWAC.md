# Handover: aligning qwac with this registry

Audience: whoever (person or agent) picks up
[`CorrelAid/qwac`](https://github.com/CorrelAid/qwac) next — the SvelteKit SPA
that browses the question bank. This document is the plan; the work is split into
issues in that repo, linked below. Each issue stands on its own — an agent should
be able to act on one without reading the others.

Companion documents:
[`HANDOVER_FORMULAID.md`](HANDOVER_FORMULAID.md) (the survey generator, which has
the same upstream gap) and
[`HANDOVER_FORMTRANSFORM_APP.md`](HANDOVER_FORMTRANSFORM_APP.md) (the converter
app, a dependency migration rather than a drift problem).

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
[Supported XLSForm Subset](README.md#supported-xlsform-subset).

## What this repo can and cannot hand over

Available now from the package root (`github:CorrelAid/formtransform`):

- `TYPE_MAPPINGS` — per-type mapping facts: `kind`, `limeSurveyType`,
  `supported`, `requiresListName`, `answerClass`, `dateFormat`.
- The four conversion directions (`XLSFormParser.convertXLSDataToTSV`,
  `buildDdiXml`, `lstsvToDdiXml`, `lstsvToXlsform`) — qwac needs none of them
  today, but `lstsvToDdiXml` is worth knowing about if the app ever grows an
  export path.
- `skills/cdl-survey-types/references/question-types.md` in this repo — not part
  of the package, but its `##` headings carry the registry's `skos:prefLabel` for
  every type, which is where the labels for issue #9 come from.

**Not available, and this is what shapes the plan:** there is no labelled,
machine-readable type catalogue. `skos:prefLabel`, `useWhen` and the variant →
base relation live in `registry/`, and the package sets `"files": ["dist"]`, so
`registry/` never reaches a consumer's `node_modules`.
`src/generated/Appearances.ts` — including the `carriesData` flag a preview UI
wants, false for matrix headers — is generated but not re-exported from
`src/index.ts`.

Both gaps are an addition to `codegen/emit_ts.py` plus an export line: derived
data, not a registry change. `CorrelAid/formulaid` needs the same catalogue, so
**one upstream issue can serve both repos** — whoever files first should link the
other.

## The issues

| # | Issue | When |
|---|---|---|
| 1 | [#9 Centralise question-type knowledge in one module](https://github.com/CorrelAid/qwac/issues/9) | first; no new dependency |
| 2 | [#10 Import the type catalogue from `@correlaid/formtransform`](https://github.com/CorrelAid/qwac/issues/10) | after #9 **and** after the upstream catalogue ships |
| 3 | [#11 Upstream gaps: labelled catalogue, `APPEARANCES` export](https://github.com/CorrelAid/qwac/issues/11) | now; tracking only, blocks #10 |
| — | [#12 Upload page: show why DDI validation failed](https://github.com/CorrelAid/qwac/issues/12) | any time; relates to existing #8 |

Issue #9 is deliberately doable with no dependency at all: it collapses the
scattered type knowledge into one `src/lib/questionTypes.ts`, whose contents #10
then swaps for the imported catalogue in a single edit. Splitting it this way
means the useful half of the work is not blocked on an upstream release.

Issue #10 also adds the payoff test — when the registry gains a data-carrying
question type that has no preview component, the suite fails and the app gets
told, instead of quietly rendering a bare tag.

## qwacback, while you are here

Two things worth filing against
[`CorrelAid/qwacback`](https://github.com/CorrelAid/qwacback) rather than fixing
in qwac:

- **`src/lib/ddi.ts` should not exist.** It is a ~100-line parser for Go
  `fmt.Sprintf("%v", map)` output — `map[#text:value -attr:value]` — that
  qwacback stores in PocketBase text fields. The app is reverse-engineering Go's
  debug format to render DDI content. If the API returned JSON (or the DDI XML
  itself), `ddi.ts` and its test could be deleted outright.
- **Structured validation findings.** If `/api/validate` collapses XSD and
  Schematron failures into one opaque blob, issue #12 cannot do its job properly;
  ask for findings that distinguish the two.

qwacback also has its own registry-consumption brief, currently untracked at
`REGISTRY_SYNC.md` in that working copy — delete the vendored Go converter, the
vendored XSDs/Schematron and the Java worker source; consume
`@correlaid/formtransform` plus `ghcr.io/correlaid/schematron-worker` pinned to
one version. The plan still holds, but three details in it went stale: the repo
is `CorrelAid/formtransform` (not `survey-type-registry`), example fixtures live
at `registry/entities/<slug>/fixtures/xlsform.json` (not
`registry/types/<slug>/examples/<variant>/xlsform.json`), and `lstsv2ddi` /
`lstsv2xlsform` now exist, which the brief predates.

## Hard rules for whoever does the work

- **Do not modify this repo from qwac.** Missing capability → open an issue here
  (that is what #11 is for).
- **Do not vendor `registry/`.** A copied JSON-LD graph is drift with extra
  steps. If the data is not exported, the fix is an emitter change here.
- **Do not hand-edit generated files.** Everything under `src/generated/` and
  `skills/cdl-survey-types/` carries a "DO NOT EDIT" header and is overwritten by
  the next `uv run codegen`.
- **Pin to tags, not branches.** A registry change should never alter a deployed
  UI without a commit in qwac.
- **Unknown types must still render.** qwacback can hold data the app has not
  been taught about; degrade to a plain tag rather than throwing.

## Related documents

- [`README.md`](README.md) — what this repo ships and to whom
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — registry → codegen → artifacts
- [`HANDOVER_FORMULAID.md`](HANDOVER_FORMULAID.md) — the survey generator's plan,
  sharing the catalogue gap
- [`HANDOVER_FORMTRANSFORM_APP.md`](HANDOVER_FORMTRANSFORM_APP.md) — the converter
  app's migration
