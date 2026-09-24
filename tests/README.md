# Tests

Suites are organised by **what a failure means**, not by which runner executes
them. Four layers, each answering a different question:

| Layer | Question it answers | Runner | Where |
|---|---|---|---|
| `unit` | Does a transformation behave correctly? | vitest | `src/test/**` (minus `contract/`, `integration/`) |
| `integration` | Does the library handle a whole hand-authored survey? | vitest | `src/test/integration/` |
| `contract` | Did output drift from the blessed snapshots (registry entities **and** whole surveys)? | vitest | `src/test/contract/` |
| `validation` | Do the committed artifacts satisfy external standards? | pytest | `tests/validation/` |
| `live` | What does a real survey engine do with them? | pytest + docker | `tests/live/` |

TypeScript tests live next to the library they test (`src/`); Python owns
everything that needs a JVM, an external oracle, or a running engine.

## What drives what

| Transformation | Where the code lives | Where the tests live |
|---|---|---|
| XLSForm → LimeSurvey TSV | **in-repo** (`src/`, the TS library) | vitest — `src/test/`, snapshots in `src/test/contract/tsvSnapshots.test.ts` |
| XLSForm → DDI XML | **in-repo** (`src/ddi/`) | vitest — `src/test/ddi/`, snapshots in `src/test/contract/ddiSnapshots.test.ts` |
| LimeSurvey TSV → DDI / XLSForm (reverse) | **in-repo** (`src/lstsv/`, `src/pipelines/lstsv2ddi/`, `src/pipelines/lstsv2xlsform/`) | vitest — those dirs + `src/test/contract/*Roundtrip.test.ts` |
| DDI XSD + Schematron validation | **in-repo** (`workers/schematron-worker/`, Java; rules in `ddi-validation/`) | pytest — `tests/validation/test_ddi_schema.py`, `test_registry_schematron_conformance.py` |
| XLSForm fixture inputs are valid XLSForm | external oracle ([pyxform](https://github.com/XLSForm/pyxform)) | pytest — `tests/validation/test_xlsform_pyxform.py` |
| LimeSurvey accepts the blessed TSV snapshots | live LimeSurvey (docker) | pytest — `tests/live/limesurvey/test_registry_entities.py` |
| What LimeSurvey *stores* when a respondent answers | live LimeSurvey (docker) + Playwright | pytest — `tests/live/limesurvey/test_response_roundtrip.py` |
| qwacback's Go converter emits the same DDI shape as `buildDdiXml` | live qwacback (docker) | pytest — `tests/live/qwacback/test_qwacback_equivalence.py` |

qwacback still runs its own Go XLSForm → DDI converter. It plans to replace it
with this library ([HANDOVER_QWAC.md](../HANDOVER_QWAC.md)), and the
equivalence test is the parity check for that swap. After the swap it compares
the library with itself and can go.

## Layout

```
src/test/                                   # vitest
  contract/                                 #   blessed-snapshot gates (bless, don't edit)
    tsvSnapshots.test.ts                    #     registry contract + byte-for-byte tsv.tsv
    ddiSnapshots.test.ts                    #     byte-for-byte ddi.xml
    lstsv2ddiRoundtrip.test.ts              #     tsv.tsv → ddi == committed ddi.xml
    lstsv2xlsformRoundtrip.test.ts          #     tsv.tsv → xlsform == authored xlsform.json
    fullRoundtrip.test.ts                   #     xlsform → tsv → xlsform
    surveySnapshots.test.ts                 #     whole surveys, every direction
  integration/                              #   whole hand-authored surveys through the library
  ddi/ lstsv/ lstsv2xlsform/ expressions/   #   unit tests per subsystem
  questionTypes/ *.test.ts                  #   unit tests per question type / feature
tests/
  validation/                               # pytest: committed artifacts vs external standards
    fixtures.py                             #   registry loader + ddi.xml snapshot loader
    test_ddi_schema.py                      #   blessed ddi.xml → XSD + Schematron (Java worker)
    test_registry_schematron_conformance.py #   schematron covers registry + rejects violations
    test_xlsform_pyxform.py                 #   every xlsform.xlsx is valid XLSForm (pyxform oracle)
  live/                                     # pytest, auto-marked `docker`
    conftest.py                             #   applies the `docker` marker to this tree
    limesurvey/
      docker-compose.yml                    #   the repo's single LimeSurvey stack
      test_registry_entities.py             #   each blessed tsv.tsv imports into LimeSurvey
      test_response_roundtrip.py            #   answer each entity, snapshot what gets stored
      test_*.py                             #   structure/settings/multilingual scenarios
      respondent.py                         #   export + snapshot helpers (citric)
      fill_limesurvey.mjs                   #   Playwright: fill + submit a live survey page
      answers/<slug>.json                   #   what the respondent enters
      expected/<slug>.json                  #   blessed exported response
      output/                               #   generated TSVs (gitignored)
    qwacback/
      docker-compose.yml                    #   qwacback alone (QWACBACK_IMAGE; the ghcr image is private)
      test_qwacback_equivalence.py          #   same XLSForm → buildDdiXml vs. qwacback, DDI shape compared
      build_ddi.mjs                         #   buildDdiXml from dist/ over stdin/stdout
  fixtures/surveys/<name>/                  # one folder per whole survey, like a registry entity
    xlsform.json | xlsform.xlsx              #   authored source
    tsv.tsv  ddi.xml                         #   blessed forward snapshots
```

Stack lifecycle (compose file, base URL, credentials, import+activate) lives in
[`codegen/limesurvey_stack.py`](../codegen/limesurvey_stack.py) — one stack, shared
by the live suite and `codegen --screenshots`, so a rendering bug and a data bug
can never disagree about which LimeSurvey they are looking at.

## What gets asserted

### DDI emitter + structural snapshots (`src/test/ddi/`, `src/test/contract/ddiSnapshots.test.ts`)

The in-repo emitter's own suite: unit tests for variable extraction, note
classification, XML formatting, and per-type/`varGrp` construction, plus a
byte-for-byte snapshot comparison of `buildDdiXml` output against every
committed `ddi.xml` (`prodDate` scrubbed).

### DDI XSD + Schematron validation (`tests/validation/test_ddi_schema.py`)

Each blessed `ddi.xml` is fed to the in-repo Java worker jar in CLI mode, which
runs **both** DDI 2.5 XSD validation and the CDL custom Schematron rules
(`ddi-validation/`). Skips when the jar is unbuilt (`bash scripts/build-worker.sh`,
JDK 21).

### Schematron coverage + teeth (`tests/validation/test_registry_schematron_conformance.py`)

1. **Coverage audit** (always runs): every named registry concept
   (multipleResp, grid, other, concept/@vocab, intrvl, responseDomainType,
   catValu) must be referenced in `ddi_custom_rules.sch` — catches contracts
   the registry declares but Schematron ignores.
2. **Mutation tests** (need the jar): mutate a blessed `ddi.xml` to break a
   contract, assert Schematron rejects it — proves the rules aren't toothless.

### XLSForm → LimeSurvey TSV (`src/test/`, vitest)

Contract assertions against the in-repo converter: `type/scale` matches
`limesurvey.typeCode` per LS-supported type, `or_other` → `other="Y"`, variant
examples produce Q-rows, plus byte-for-byte `tsv.tsv` snapshot comparison.

### XLSForm fixture validity (`tests/validation/test_xlsform_pyxform.py`)

Each entity's `xlsform.xlsx` is fed to [pyxform](https://github.com/XLSForm/pyxform),
the reference XLSForm→XForm compiler used by ODK Collect / Enketo. It asserts a
standards-compliant engine accepts our fixture **inputs** — catching malformed
type strings, dangling `list_name`s, or missing columns before they poison the
snapshot suite. pyxform validates inputs only; it emits ODK XForm, not TSV/DDI,
so it is not an output oracle. Skips if pyxform is not installed.

### Whole surveys, every direction (`src/test/contract/surveySnapshots.test.ts`)

The per-entity suites pin one question type at a time, so anything that only
exists *between* questions is invisible to them: group nesting, page breaks, a
multilingual column set, expressions referencing another question, the
welcome/end-note conversions. Each `tests/fixtures/surveys/<name>/` folder holds
the same trio as a registry entity — authored source plus blessed `tsv.tsv` and
`ddi.xml` — and is asserted in four directions:

| Direction | Assertion |
|---|---|
| xlsform → tsv | byte-for-byte vs `tsv.tsv` |
| xlsform → ddi | byte-for-byte vs `ddi.xml` (`prodDate` scrubbed) |
| tsv → ddi | same variables + response domains as the forward DDI, names sanitized |
| tsv → xlsform | every recovered question keeps a name and a type |

Byte parity is impossible on the reverse DDI path for any survey whose authored
names carry separators (LimeSurvey names are alphanumeric-only and capped at 20
chars), so that direction compares the variable list rather than the document.
Surveys whose variable list legitimately differs are listed in
`REVERSE_DDI_STRUCTURAL_DIFF` with a **measured** reason, and the list is asserted
to name only real fixtures — a stale entry fails the suite.

This suite immediately earned its keep: it caught the reverse path degrading a
`minimal` (dropdown) `select_one` into free text, because `LS_TO_STD` and the
reverse subset validator each hardcoded the appearance overrides they knew
(`T`) and missed `!`. Both now derive from `APPEARANCES` in the registry, so a
new override teaches both sides automatically. No registry entity uses
`minimal`, which is exactly why single-question fixtures could not see it.

`testA` ships no snapshots on purpose — it carries an unimplemented `range` type,
so the bless script skips it and the suite skips it with it.

### Live LimeSurvey import (`tests/live/limesurvey/test_registry_entities.py`)

Every blessed per-entity `tsv.tsv` is imported into a dockerized LimeSurvey via
the `citric` API client and asserted to land with ≥1 question. The vitest suite
proves the TSV matches the converter; this proves LimeSurvey itself accepts it.

### Live respondent round-trip (`tests/live/limesurvey/test_response_roundtrip.py`)

Import → activate → **fill the survey in a real browser** (Playwright,
`fill_limesurvey.mjs`) → submit → `export_responses` → compare the stored values
against `expected/<slug>.json`. The only suite that asserts *data* semantics
rather than structure: it is what catches a `time` question stored as a datetime,
an answer code truncated by LimeSurvey's `varchar(5)`, or an "other" free text
landing in an unexpected response column.

Inputs live in `answers/<slug>.json`, keyed by question code:

| Answer shape | Meaning |
|---|---|
| `"3"` | single value — a choice code, or free text for text/numeric/date |
| `["sa", "so"]` | multiple choice — tick these subquestion codes |
| `{"vertrauenpolizei": "5"}` | array/grid — subquestion code → answer code |
| `{"other": "Zeitung"}` | the built-in "other" option (also valid inside the array form) |

Every entity with a `tsv.tsv` must have an answers fixture (`note` has an empty
one — a note stores nothing, and the blessed snapshot records that).

Needs node + Playwright/Chromium on top of the docker stack; skips if Playwright
is not resolvable (locally or globally).

### qwacback equivalence (`tests/live/qwacback/test_qwacback_equivalence.py`)

Ported from survey2ddi (formtransform#14). For every answer type qwacback
supports, the same XLSForm goes through `buildDdiXml` and qwacback's
`POST /api/convert/xlsform-to-ddi`, and the `<var>`/`<varGrp>` shapes are
compared. qwacback returns a bare `<var>` or `<varGrp>` when there's only one,
so the test wraps it in a `<dataDscr>`. Two cases are strict xfails: `range`
(#33) and `note` (by design: formtransform emits no `<var>` for a note).

The fixture starts qwacback from its own compose file, or uses `QWACBACK_URL`.
`ghcr.io/correlaid/qwacback` is private: log in to ghcr.io, or build it
(`docker build -t qwacback:local ../qwacback`) and set
`QWACBACK_IMAGE=qwacback:local`. If the image can't be pulled, the tests skip
with that reason.

## Running

```bash
npm test                  # vitest: all three projects
npm run test:unit         # one project (also :integration, :contract)
uv run pytest             # python: validation suites (live excluded by default)
npm run test:live         # docker: brings the stack up, runs tests/live, tears down
npm run test:live -- -k response_roundtrip    # args pass through to pytest
npm run test:all          # everything

bash scripts/build-worker.sh   # needed once for the DDI XSD/Schematron tests
```

Live tests are excluded from a plain `uv run pytest` by the default
`-m "not docker"` filter in `pyproject.toml`; `tests/live/conftest.py` applies
that marker to the whole tree at collection time, so no test has to remember it.

## Snapshot blessing workflow

`registry/entities/<slug>/{ddi.xml,tsv.tsv}`,
`tests/fixtures/surveys/<name>/{ddi.xml,tsv.tsv}` and
`tests/live/limesurvey/expected/*.json` are **frozen reference snapshots**, not
auto-regenerated by `codegen`. The `contract` project and the live response
suite run the current code and assert output matches the committed files.

- **Change is correct** → bless new output:

  ```bash
  npm run bless                  # examples + tsv.tsv + ddi.xml + whole surveys
  npm run bless -- ddi           # or one target: examples | tsv | ddi | surveys | responses
  npm run bless -- surveys       # tests/fixtures/surveys/<name>/{tsv.tsv,ddi.xml}
  npm run bless -- responses     # live stored-response snapshots (needs docker)
  git diff registry/entities/ tests/fixtures/surveys/ tests/live/limesurvey/expected/
  ```

- **Change is a regression** → fix the emitter/converter, leave snapshots alone.

Default `uv run codegen` only writes `meta.json` and `xlsform.xlsx`
(deterministic from JSON-LD); it does **not** touch `ddi.xml` / `tsv.tsv`.

## Adding a new test

- **Transformation behaviour** → vitest under `src/test/` (next to the
  subsystem). Assert against the registry contract, not literal expected values,
  where possible.
- **A new blessed snapshot** → put the test in `src/test/contract/` so a failure
  reads as "bless or fix", not "logic bug".
- **A whole survey scenario** → add `tests/fixtures/surveys/<name>/xlsform.json`,
  run `npm run bless -- surveys`, and `surveySnapshots.test.ts` picks it up in all
  four directions. Behavioural assertions about that survey go in
  `src/test/integration/`.
- **External standard / oracle** → `tests/validation/`.
- **Behaviour of a real engine** → `tests/live/<engine>/`; the `docker` marker is
  applied for you.
