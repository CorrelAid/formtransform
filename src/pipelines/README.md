# Pipelines

One module per supported direction. A pipeline owns everything cross-format; the
format modules it draws on (`src/xlsform/`, `src/lstsv/`, `src/ddi/`) never
import each other.

| Pipeline | Direction | Purpose |
| --- | --- | --- |
| [`xlsform2lstsv/`](xlsform2lstsv/) | XLSForm → LimeSurvey TSV | deploy the authored survey |
| [`xlsform2ddi/`](xlsform2ddi/) | XLSForm → DDI Codebook 2.5 | document the resulting dataset |
| [`lstsv2ddi/`](lstsv2ddi/) | LimeSurvey TSV → DDI Codebook 2.5 | document a survey that only exists in LimeSurvey |
| [`lstsv2xlsform/`](lstsv2xlsform/) | LimeSurvey TSV → XLSForm | recover an authorable source from a deployed survey ([known losses](lstsv2xlsform/README.md)) |

Both DDI pipelines converge on the same emitter: they produce `Variable[]`
(`src/ddi/types.ts`) and hand it to `buildDdiCodebook`. The variable model is the
hub, not any one format.

## The DDI data file

`src/ddi/data.ts` emits the response-data CSV that the codebook describes
(`buildDataCsv`, plus `getDdiColumnNames` / `remapSubmissionsToDdi` for callers
writing the file themselves). It is schema-side-agnostic in the same way the XML
emitter is: it takes `Variable[]` and raw response rows, so either DDI pipeline
can feed it.

Its one hard contract is **column order equals `<var name="">` order**. The
column plan walks the same buckets `dataDscr` does — grid-group members,
`select_multiple` binaries, `_other` patterns, standalone variables — so every
header matches a `<var>` in the XML, position for position, and schema↔data
alignment stays a zip rather than a lookup. A `select_multiple` expands to one
`0`/`1` column per choice; `note` variables get no column at all.

Response rows are keyed by bare question name or by the slash-joined group path
(`group/name`) Kobo's CSV export uses — both are accepted, bare name wins.

A LimeSurvey response export is keyed differently, so `lstsv2ddi/data.ts`
(`normalizeLimeSurveyResponses`, used by `lstsvToDataCsv`) re-keys it first and
then hands the rows to the same `buildDataCsv`:

- keys are matched with underscores stripped and case folded (`beruf_post` is
  exported as `berufpost`)
- a multiple-choice question is one `q[code]` column per option holding `Y`;
  codes truncated to 5 characters are recovered by unique prefix, and an
  ambiguous prefix throws
- an array (`F`) is one `array[sq]` column per subquestion holding the answer
  code, which fills the grid variable named after the subquestion
- native "other": a list stores `-oth-` (mapped to `other`), and the free text
  in `q[other]` (or an authored `qother`) fills the `<base>_other` companion

These LimeSurvey quirks stay in `lstsv2ddi/`; the shared emitter and the Kobo
path never guess at them.

## Why there is no `ddi2xlsform` or `ddi2lstsv`

Deliberate, not a gap. **DDI is the terminus of the pipeline graph** — it
describes a *dataset*, not an *instrument*, so it does not carry the information
a survey needs to run.

The canonical `Variable` (`src/ddi/types.ts`) is what survives an emit: `name`,
`type`, `label`, group path/label/appearance, `listName`, `vocab`, `choices`,
and the question's `hint` (`<preQTxt>`) and `guidance_hint` (`<ivuInstr>`).
Everything that makes a form behave is absent:

- **no `relevant`** — DDI Codebook 2.5 has no machine-readable expression syntax
  at all, so skip logic is dropped on the way in. `convention:logicMapping`
  ([`registry/conventions/logicMapping.jsonld`](../../registry/conventions/logicMapping.jsonld))
  records this and requires tools to report it as loss.
- **no `constraint`** — same reason.
- **no `required`, `default`, per-question `appearance`, `calculation`.**

Compare `lstsv2xlsform`, which *is* implemented: a LimeSurvey structure TSV
carries `relevance`, `em_validation_q`, `mandatory`, `default` and the `!`/`T`
type overrides. It is a form definition in a different dialect, so reversing it
is a translation problem. Reversing DDI is not — it is a *reconstruction*
problem, and the missing pieces cannot be inferred from a codebook.

The failure mode matters more than the missing feature. A `ddi2xlsform` would
emit a survey that looks correct and behaves wrongly: no skip logic, no
validation, nothing mandatory. Silently producing a broken instrument is worse
than declining to produce one — the same reasoning behind
`validateLstsvSubset` rejecting out-of-subset input rather than guessing at it.

**If you need this anyway**, the honest shape is a *skeleton* generator: variable
names, labels, types, choice lists and group structure out of someone else's
codebook, as a starting point for authoring. That is a legitimate tool, but it
must never be described or tested as a round-trip, and the reconstructed form
must be reviewed before deployment. Route it as DDI → XLSForm → `xlsform2lstsv`;
a separate `ddi2lstsv` earns nothing but a second lossy reconstructor to keep in
sync.
