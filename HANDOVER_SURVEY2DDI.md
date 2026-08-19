# Handover: retiring survey2ddi's converter in favour of this library

Audience: whoever (person or agent) picks up
[`CorrelAid/survey2ddi`](https://github.com/CorrelAid/survey2ddi) next. This
document is the plan; the work splits into issues in three repos, listed below.
Each issue is written to stand on its own.

Companion to [`HANDOVER_FORMTRANSFORM_APP.md`](HANDOVER_FORMTRANSFORM_APP.md),
which is **done** — the app now runs entirely on this library, with no Pyodide
and no `survey2ddi` wheel. That migration removed the app as a consumer of
survey2ddi. This one addresses what is left: survey2ddi still ships its own
implementation of the same DDI mapping, in Python.

## Where things stand

`survey2ddi` (PyPI, v0.5.0, five releases) ships three packages:

| Package | Lines | What it does | Overlap with this library |
|---|---|---|---|
| `survey2ddi_core/{data,ddi_xml,xlsform,notes,types}.py` + `_generated/` | ~850 | XLSForm → `Variable[]` → DDI XML + response CSV | **total** — `codebook.ts`, `data.ts`, `variables.ts`, `notes.ts`, `types.ts` |
| `survey2ddi_core/ddi.py` | 76 | reads a codebook back: `read_variable_labels`, `read_value_maps`, `apply_value_labels` | **none** — this library has no DDI reader |
| `kobo2ddi/`, `limesurvey2ddi/` (clients + CLIs) | ~370 | pull from the Kobo REST API / LimeSurvey RemoteControl, then convert | **partial** — the convert half is ours, the fetch half has no equivalent here |

Two facts make the duplication urgent rather than cosmetic:

1. **The emitters have already drifted.** `survey2ddi_core.data.get_canonical_columns`
   documents "the same order `build_ddi_xml` emits them" and then returns input
   order. `ddi_xml.py` emits bucketed order (grid members → `select_multiple`
   binaries → `_other` patterns → standalone), exactly as `ddi/codebook.ts` does.
   So any survey with a grid, a `select_multiple` or an `_other` pattern gets a
   CSV whose header does not match its own XML. This library's `buildDataCsv`
   ([#5](https://github.com/CorrelAid/formtransform/issues/5), shipped) fixes it
   by deriving columns from the emitter's own bucket walk. Cell values are
   byte-identical between the two; only column order differs.
2. **survey2ddi can no longer resync the registry.** Its
   `scripts/sync-registry.sh` clones `CorrelAid/survey-type-registry`, which no
   longer exists — the registry lives in this repo now. Its
   `_generated/type_mappings.py` is frozen at registry `v1.0.0`, and the
   `registry-drift` CI job cannot pass on a fresh run. Its type decisions are
   therefore unmaintainable in place, which is the whole argument for the
   consolidation.

## Target architecture

**This library owns every conversion and both API pulls. survey2ddi shrinks to
the read side.**

| Concern | Today | After |
|---|---|---|
| XLSForm → DDI XML | both | `formtransform xlsform2ddi` |
| XLSForm + responses → data CSV | survey2ddi only (`build_data_csv`) | `formtransform xlsform2ddi --data` (**CLI flag missing, [FT-1](https://github.com/CorrelAid/formtransform/issues/10)**) |
| LimeSurvey TSV → DDI XML | both | `formtransform lstsv2ddi` |
| LimeSurvey responses → data CSV | survey2ddi only (`normalize_responses`) | `formtransform lstsv2ddi --data` (**not ported, [FT-2](https://github.com/CorrelAid/formtransform/issues/11)**) |
| Kobo API pull | `kobo2ddi pull` | `formtransform kobo pull` (**[FT-3](https://github.com/CorrelAid/formtransform/issues/12)**) |
| LimeSurvey API pull | `limesurvey2ddi pull` | `formtransform limesurvey pull` (**[FT-4](https://github.com/CorrelAid/formtransform/issues/13)**) |
| DDI codebook → labels, value maps, labelled dataframe | `survey2ddi_core.ddi` | unchanged — stays Python |

Why the read side stays in Python: `apply_value_labels` exists to label a pandas
dataframe. Its users are analysts in notebooks (`examples/basic/analysis_example.ipynb`),
and a TypeScript port would serve nobody. Keeping a small `survey2ddi` on PyPI
also keeps the name's five published releases meaningful instead of stranded.

**The trade this makes explicit:** the ops path (pull + convert) becomes
node-only. Anyone scripting a Kobo pull in Python today will need `npx
formtransform` or a `subprocess` call. That is the cost of one implementation
instead of two, and it should be stated in the deprecation notice rather than
papered over.

### Rejected alternative

Keep the Python CLIs and have `cmd_transform` shell out to the `formtransform`
binary. It preserves the one-command UX, but it makes a pip package depend on a
node runtime it cannot declare or install — worse than the honest split above.
If the ops-in-Python constraint turns out to be hard, this is the fallback, and
in that case survey2ddi keeps its clients permanently and only deletes
`survey2ddi_core`'s emit core.

## The issues

### In this repo (`CorrelAid/formtransform`) — do these first

**[FT-1](https://github.com/CorrelAid/formtransform/issues/10) — `xlsform2ddi`: emit the data CSV from the CLI.** The API shipped in
[#8](https://github.com/CorrelAid/formtransform/pull/8); `src/cli.ts`'s
`cmdXlsform2ddi` still passes no `submissions`, so `<caseQnty>` is always `0` and
there is no way to get a `data.csv` without writing TypeScript. Add
`--data <responses.{csv,json}>` (read + parse), `--data-out <path>` (default
`data.csv` beside the XML), wire `submissions` into `buildDdiXml` so `caseQnty`
and `<fileDscr>` are right, and accept Kobo's submissions JSON shape as well as
a flat CSV. This is the smallest issue and it blocks the deprecation notice.

**[FT-2](https://github.com/CorrelAid/formtransform/issues/11) — port `normalize_responses` for the LimeSurvey response path.**
`limesurvey2ddi/transform.py` re-keys LimeSurvey response dicts onto DDI variable
names: bracket-subkey → choice-code matching, plus LimeSurvey's underscore-strip
export quirk (`_norm`). `buildDataCsv` accepts bare names and `group/name` paths,
neither of which is what a LimeSurvey export produces. Port it as
`pipelines/lstsv2ddi/data.ts` (`lstsvToDataCsv`, or a key-normalizing adapter fed
into `buildDataCsv`), and add `--data` to `lstsv2ddi` per FT-1. Without this, the
LimeSurvey full path has no TS equivalent and cannot be deprecated.

**[FT-3](https://github.com/CorrelAid/formtransform/issues/12) — Kobo pull adapter + `formtransform kobo` command.** Port
`kobo2ddi/client.py` (98 lines, httpx → `fetch`): `list_assets`, `get_asset`,
`get_submissions` (paginated), `download_xlsform`. Note the API serves **xlsx**
from the `.xls` endpoint, which SheetJS reads, so no legacy-BIFF work is needed.
Subcommands `list` / `pull` / `transform` mirroring the Python CLI. Token from
`--token` or `KOBO_API_TOKEN`; `--server-url` defaulting to
`https://eu.kobotoolbox.org`. Keep it out of `src/index.ts`'s browser surface —
same rule as `cli.ts` and `fileChoices.ts`.

**[FT-4](https://github.com/CorrelAid/formtransform/issues/13) — LimeSurvey pull adapter + `formtransform limesurvey` command.** Port
`limesurvey2ddi/client.py`: RemoteControl JSON-RPC, session-key acquire/release,
`list_surveys`, `get_responses`, plus the survey-structure TSV export that
`lstsv.py` handles. More care than FT-3 — session expiry and the RPC error shape
are the awkward parts. Prior art in this repo: `tests/live/` drives the same API
through the `citric` Python client via `codegen.limesurvey_stack`, which is a
reference for the call sequence (and a reason to consider whether the live suite
should exercise the new TS client instead).

**[FT-5](https://github.com/CorrelAid/formtransform/issues/14) — adopt the parity tests that currently live in survey2ddi.**
`tests/integration/test_conversion_equivalence.py` compares survey2ddi's DDI
against **qwacback's** for every type qwacback supports. Deleting survey2ddi's
emitter deletes that coverage, and qwacback is a real consumer of this library.
Port it to compare `buildDdiXml` against qwacback. Separately, add a temporary
Python↔TS byte-parity script over the fixture corpus — it is the gate for S2D-2
and gets deleted with the Python emitter.

**[FT-6](https://github.com/CorrelAid/formtransform/issues/15) — docs.** README's ecosystem table gains the Kobo/LimeSurvey pull
commands; `src/pipelines/README.md` gets the LimeSurvey data path from FT-2;
state survey2ddi's new reader-only scope wherever it is named.

### In `CorrelAid/survey2ddi`

**[S2D-1](https://github.com/CorrelAid/survey2ddi/issues/3) — run the parity gate and record the divergences.** Using FT-5's script:
every fixture, both emitters, byte-compare XML and CSV. Expect exactly one class
of difference (CSV column order, where Python is wrong). Anything else is a
finding that must be triaged before deletion — a Python behaviour this library
lacks is a bug in this library, not a reason to keep the Python.

**[S2D-2](https://github.com/CorrelAid/survey2ddi/issues/4) — delete the emit core.** `survey2ddi_core/{data,ddi_xml,xlsform,notes,types}.py`,
`_generated/`, `scripts/{sync-registry,check-registry-drift}.sh`, the
`registry-drift` CI job, `.registry-version`, and the `openpyxl`/`xlrd`
dependencies. Keep `survey2ddi_core/ddi.py` and its `__init__` exports — that
file is already the package's entire public `__all__`. Gated on S2D-1.

**[S2D-3](https://github.com/CorrelAid/survey2ddi/issues/5) — deprecate the CLIs, then remove them.** `0.6.0`: `kobo2ddi` and
`limesurvey2ddi` keep working but emit a `DeprecationWarning` naming the
replacement command (`formtransform kobo pull …`), and `cmd_transform` /
`cmd_metadata` say so on stderr. `1.0.0`: drop both packages and `httpx`,
leaving a reader-only distribution. Gated on FT-1 through FT-4 — do not
deprecate a command whose replacement does not exist yet.

**[S2D-4](https://github.com/CorrelAid/survey2ddi/issues/6) — rewrite the package's story.** README, `AI_DISCLOSURE.md`, and the
`pyproject.toml` description/keywords for a DDI-reader package. Verify
`examples/basic/analysis_example.ipynb` still runs against the checked-in
`101.xml` with the emitter gone.

### In `CorrelAid/cdl-wp-eins`

**[WP-1](https://github.com/CorrelAid/cdl-wp-eins/issues/26) — retarget the public docs.** Eight files name survey2ddi as the
conversion tool: `src/content/snippets/survey2ddi/{de,en}.html`,
`src/lib/toc.json` (entry with `"phases": [3]`), `src/pages/workflow.astro`
(two rows), `src/lib/components/EcosystemFlowchart.astro` (two nodes, both
"Aus XLSForm + KoboToolbox CSV mit survey2ddi"),
`src/content/pages/{umfragetool-einladung,kobotoolbox,nachnutzbarkeit}.mdx`.
Point conversion at formtransform / the app, and keep survey2ddi listed as the
analysis-side reader rather than deleting it from the ecosystem picture. Same
pattern as the scope-notice snippet from the app migration
([cdl-wp-eins#25](https://github.com/CorrelAid/cdl-wp-eins/pull/25)).

## Order and gates

```
FT-1 (ft#10) ─┐
FT-2 (ft#11) ─┼─► S2D-3 (s2d#5): 0.6.0 deprecate ─► 1.0.0 removal
FT-3 (ft#12) ─┤
FT-4 (ft#13) ─┘
FT-5 (ft#14) ───► S2D-1 (s2d#3) ───► S2D-2 (s2d#4) ───► S2D-4 (s2d#6) ───► WP-1 (wp#26)
```

`ft` = `CorrelAid/formtransform`, `s2d` = `CorrelAid/survey2ddi`,
`wp` = `CorrelAid/cdl-wp-eins`.

FT-1 and FT-5 are independent and can run in parallel. Nothing in survey2ddi is
touched until its replacement is on `main` here.

## Hard rules for whoever does the work

- **No user-facing capability disappears to reach a green grep.** Same rule as
  the app migration. If a Python path has no TS equivalent yet, the issue stops
  and says so — it does not delete the feature.
- **The parity gate is not optional.** S2D-2 without S2D-1 is deleting a
  reference implementation on faith.
- **A Python behaviour missing here is a bug here.** Fix it upstream in this
  repo, do not keep the Python alive as a workaround.
- **Secrets stay in env vars.** `KOBO_API_TOKEN`, `LIME_SERVER_URL`,
  `LIME_USERNAME`, `LIME_PASSWORD` keep their names in the TS clients so existing
  `.env` files keep working. Note that `python-dotenv` has no dependency in the
  node port — `node --env-file` covers it.
- **The browser bundle stays clean.** Neither pull adapter may be re-exported
  from `src/index.ts`; the app must not start shipping an HTTP client.

## Related documents

- [`HANDOVER_FORMTRANSFORM_APP.md`](HANDOVER_FORMTRANSFORM_APP.md) — the completed
  app migration that made this one possible
- [`HANDOVER_QWAC.md`](HANDOVER_QWAC.md) — qwacback's consumption of this repo,
  relevant to FT-5
- [`HANDOVER_CDL_WP_EINS.md`](HANDOVER_CDL_WP_EINS.md) — how the docs site
  consumes the ecosystem, relevant to WP-1
