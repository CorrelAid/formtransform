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
column plan walks the same survey-ordered questions `dataDscr` does (#152) —
a `select_multiple` as its binaries, an `_other` pair as its select then its
text — so every header matches a `<var>` in the XML, position for position, and schema↔data
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

## The way back from DDI (`ddi2xlsform`)

A codebook describes a *dataset*, not an *instrument*, but one formtransform
wrote carries the whole instrument too (#155, #151–#153). `ddi2xlsform`
(#154) reads it back: [`ddi2xlsform/README.md`](ddi2xlsform/README.md) has
the mapping, the input it accepts and the known losses.

What a CDL codebook carries beyond the canonical `Variable`
(`src/ddi/types.ts`: `name`, `type`, `label`, group path/label/appearance,
`listName`, `vocab`, `choices`):

- **`relevant`, `constraint`, `constraint_message`, `required`.** DDI Codebook
  2.5 has no expression syntax, so each is written twice: readable
  (`<universe>` prose, `<valrng>` for a simple numeric range) and exact, in a
  typed note (`<notes type="cdl:relevant" subject="xlsform-xpath">`).
  `convention:logicMapping`
  ([`registry/conventions/logicMapping.jsonld`](../../registry/conventions/logicMapping.jsonld),
  `ddiEncoding`) defines them. A group's own condition is on its `varGrp`;
  a variable's `<universe>` states its groups' conditions too.
- **groups and order** (#152): every group is a `<varGrp>` (a plain one
  `type="section"`), nested through `@varGrp`, and the `<var>`s follow the
  survey.
- **every other field** (#153): standard DDI where it has a home (`postQTxt`
  for the hint, `ivuInstr` for `guidance_hint`, a note row as `preQTxt`,
  `varFormat/@category`, `var/@dcml`, `valrng`, `qstn/@seqNo`,
  `qstn/backward`), else a typed note. `convention:ddiFields`
  ([`registry/conventions/ddiFields.jsonld`](../../registry/conventions/ddiFields.jsonld))
  maps every model field, or names it a loss.
- **what a form needs to be rebuilt** (#160): list names (`cdl:list`), the
  `or_other` shorthand (`cdl:or_other`), note rows' names, fields and places,
  rows without data (`cdl:row`), every setting and the form's language names,
  so a codebook's XLSForm converts to the same codebook.

DDI formtransform didn't write (a hand-written seed study, another tool's
codebook) has none of the `cdl:` notes. `ddi2xlsform` still converts it, as a
skeleton: names, labels, types, choices and groups, with a `ddi-field-missing`
warning for each field it can't supply. Such a form must be reviewed before it
is deployed: it has no skip logic, validation or required answers unless
someone adds them. There is no `ddi2lstsv`; DDI → XLSForm → `xlsform2lstsv`
does it without a second reconstructor to keep in sync.
