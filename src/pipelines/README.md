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

## Why there is no `ddi2xlsform` or `ddi2lstsv`

Deliberate, not a gap. **DDI is the terminus of the pipeline graph** — it
describes a *dataset*, not an *instrument*, so it does not carry the information
a survey needs to run.

The canonical `Variable` (`src/ddi/types.ts`) is what survives an emit: `name`,
`type`, `label`, group path/label/appearance, `listName`, `vocab`, `choices`.
Everything that makes a form behave is absent:

- **no `relevant`** — DDI Codebook 2.5 has no machine-readable expression syntax
  at all, so skip logic is dropped on the way in. `convention:logicMapping`
  ([`registry/conventions/logicMapping.jsonld`](../../registry/conventions/logicMapping.jsonld))
  records this and requires tools to report it as loss.
- **no `constraint`** — same reason.
- **no `required`, `default`, `hint`, per-question `appearance`, `calculation`.**

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
