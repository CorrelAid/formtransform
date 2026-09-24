# lstsv2xlsform — scope and known losses

Converts a LimeSurvey structure TSV back into an XLSForm
(`{ survey, choices, settings }`, and `.xlsx` via the writer) — the reverse of
`xlsform2lstsv`. Entry point: `lstsvToXlsform(tsv, opts)` in
[`index.ts`](index.ts), which runs the same `validateLstsvSubset` reverse-subset
check as `lstsv2ddi` (shared, exported from `../../lstsv/validate.ts`) before
reconstructing: input outside the transformable subset is **rejected, not
guessed at**.

It does **not** reuse the DDI `Variable` model — that one is intentionally lossy
(drops relevance, constraint, required, appearance, hint). XLSForm needs all of
those, so this module reconstructs them directly.

## Modules

| File | Role |
| --- | --- |
| [`index.ts`](index.ts) | `lstsvToXlsform(tsv, opts)` — parse + reverse-subset validation + reconstruct |
| [`toXlsform.ts`](toXlsform.ts) | `lstsvRowsToXlsform(rows)` — the reconstruction itself |
| [`emParser.ts`](emParser.ts) | tokenizer + Pratt parser for the bounded EM dialect → AST |
| [`reverseExpressions.ts`](reverseExpressions.ts) | AST → XPath serializer; `reverseRelevance` / `reverseConstraint` + the `SelectContext` builder |
| [`languageNames.ts`](languageNames.ts) | ISO code → English exonym, to rebuild `default_language` (`"German (de)"`) from the bare code the TSV carries |

`lstsvRowsToXlsform` is two-pass: collect per-`(key, language)` label maps first
(order-independent), pre-scan to build the global `selected()`-reconstruction
context (any question's relevance may reference any `select_multiple` in the
document, not just one in its own group), then walk base-language rows into
groups → questions → survey/choices rows.

CLI: `formtransform lstsv2xlsform <input.tsv>`.

## Reverse mappings

| LimeSurvey input | XLSForm output | Notes |
| --- | --- | --- |
| type L/M/N/D/S/X, plus F | `select_one` / `select_multiple` / `integer`\|`decimal`\|`range` / `date`\|`time` / `text` / `note`, plus grid | `N` is lossy — see below |
| `N` with `min_num_value_n` + `max_num_value_n` | `range`, `parameters` rebuilt from the bounds | registry `limesurvey.parameterAttributes`; see below for `step` |
| A / SQ rows | `choices` (list_name = question name) | codes exact under strict validation |
| `other=Y` | re-add the `other` choice + `${base}_other` companion + relevance | shares `OTHER_CODE`/`OTHER_SUFFIX`/`otherLabelFor` with `lstsv/toVariables.ts` |
| `cssclass=cdlvocab-<id>` | `select_*_from_file <id>.csv`, inlined A rows dropped | shares `vocabFromCssClass` with the DDI path |
| `mandatory=Y` / `default` | `required: yes` / `default` | direct |
| type override `!` / `T` | `appearance: minimal` / `multiline` | inverts `APPEARANCES[*].lsTypeOverride` — registry-driven, not hardcoded |
| F + SQ + A | `begin_group appearance=table-list` + child `select_one`s | inverts the grid → F encoding |
| SL welcome/end text | `note` named `welcome` / `end` | inverts note promotion |
| per-language rows | `label::<lang>` / `hint::<lang>` | direct |
| S rows | settings (`default_language`, `form_title`, `style`) | direct |
| `relevance`, `em_validation_q` | `relevant`, `constraint` | reverse-transpiled — see below |

`label` / `list-nolabel` matrix appearances (the non-`table-list` matrix
pattern) are **not handled** — no fixture uses them.

## Expression reversal (EM → XPath)

The forward transpiler (`../xlsform2lstsv/xpathTranspiler.ts`) emits a constrained
subset of LimeSurvey Expression Manager syntax, so the reverser only has to
invert *that dialect* — anything outside it throws.

Validated against the **real forward transpiler as an oracle**, not hand-written
expectations: `forward(xpath) → em`, `reverse(em) → xpath'`,
`forward(xpath') → em'`, assert `em === em'`. Covers equality/inequality,
comparisons, `and`/`or`, `not()`, both `selected()` forms, and every function in
the forward dialect (`round`, `floor`→`ceiling`, `substring`, `string-length`,
`starts-with`, `ends-with`, `normalize-space`, `contains`, `today()`, `now()`).

**`selected()` vs plain equality.** For `select_one` this needs no field-type
lookup: `(name.NAOK=='v')` (parens + `.NAOK`) is a syntactically unambiguous
marker that forward only emits via `selected()` — a plain equality never gets
`.NAOK` or the wrapping parens. Only the `select_multiple` compound form
(`(name_code.NAOK=='Y')`) needs context — a map of `${question}_${code}` →
`{question, code}` built from the already-reconstructed survey, passed in as
`SelectContext`, mirroring the information the forward path's own
`buildSelectedExpr` needed.

**Constraint** goes through the same `parseEm` + `nodeToXPath` pipeline, with two
differences: `self` (the current question's value in constraint EM) maps to `.`
in XPath rather than a `${...}` reference, and no `SelectContext` is needed —
forward calls `convertConstraint` without one, so `selected()` falls back to
plain `(field=="value")` and the reverser reconstructs plain equality, the
correct context-free counterpart.

Rejected alternative: having forward stash the original XPath in a question
attribute. It would make round-tripping our own output trivial but does nothing
for TSVs produced elsewhere (and stashing was rejected for the `other` label
too).

## Known losses and caveats

These are the fields where a round-trip is **not** byte-exact. Anything not
listed here must match exactly.

1. **`N` → `integer` vs `decimal` — unrecoverable.** Both map to LimeSurvey `N`
   with no distinguishing attribute anywhere (`TYPE_MAPPINGS` entries are
   identical bar the key). No signal exists to read back without changing the
   LimeSurvey side. `lstsvRowsToXlsform` emits the canonical `decimal`;
   `integer` fixtures round-trip with `type` differing.

   An `N` with both bound attributes is read back as `range` (the only type
   that writes them). Its `step` is not stored: `num_value_int_only=1` comes
   back as `step=1`, so `start=0 end=100 step=5` returns as
   `start=0 end=100 step=1`, and a fractional step is dropped.
2. **Choice `list_name` is synthesized, not recovered.** Applies to *every*
   `select_one`/`select_multiple`, not just grids: the authored list name
   (`"select_one quelle"`) is never written to the TSV at all — only the
   flattened A/SQ rows are. The reconstruction reuses the question's own name as
   the list name (`"select_one aufmerksam"`), or the array's name for a grid
   (shared across its subquestions). Valid XLSForm, same choices/order/codes,
   different but internally consistent list identifier.
3. **`concat()` collapses one-way.** Forward maps XPath `concat(a,b)` to EM
   `a + b` — identical to numeric `+`. Reversing `+` always yields XPath
   arithmetic `+`; `concat()` is never reconstructed.
4. **Non-grid group machine names are best-effort.** A grid's machine name *is*
   recoverable (from its `F` question's own name — exact). An explicit non-grid
   group has none in the TSV, so `slugifyGroupName` falls back to: lowercase,
   strip non-alphanumeric, join the first 4 words, `'group'` if empty.
5. **Markdown vs HTML in labels is not distinguishable.** `htmlToMarkdown()`
   (`../../utils/markdownRenderer.ts`) reverses the HTML constructs `marked`
   produces (`<strong>`, `<em>`, `<a>`, `<code>`, `<p>`, `<ul>/<ol>/<li>`,
   `<h1>`–`<h6>`, `<blockquote>`, `<hr>`, `<pre><code>`) back to markdown, and is
   applied **unconditionally** to any label/hint/group-label/welcome/end-note
   string containing HTML markup. Nothing records whether the original was
   authored as markdown or as HTML, so authored HTML is also converted — the
   correct behaviour for this direction, but not a literal round-trip.
6. **Multi-language is implemented but lightly tested.** Per-language
   `S`/`SL`/`Q`/`G` rows merge into `label::<lang>`-style object maps (keyed
   correctly even though `G` rows put the label in `name` and the hint in `text`
   — the reverse of `Q` rows). Covered by unit tests, not by any fixture (none is
   multilingual). In particular the *G-translation-block* edge case — LimeSurvey
   re-blocks base-language rows before each additional language, per group flush
   rather than globally — is simplified to a single global pass. A
   multi-**group** multilingual survey could break this.
7. **`regexMatch` argument order is assumed.** `convertConstraint()`'s
   early-return path for a bare `regexMatch(...)` literal in the original XPath
   (an escape hatch for EM-flavoured syntax) swaps the arguments —
   `regexMatch(pattern, field)` — relative to the generic `transpile()` path's
   `regexMatch(field, pattern)`. Once transpiled both look identical in the TSV,
   so which one applied cannot be determined on the way back;
   `reverseConstraint` always assumes the generic (unswapped) order. No fixture
   uses either form.
8. **`calculation` is not reversed — out of scope.** `convertCalculation` reuses
   the same `transpile()` as relevance, so the reverser's core would apply
   directly, but the `calculate` XLSForm type is not registered in the registry:
   `processRow`'s allowlist throws on it before `convertCalculation` is ever
   called. No TSV this tool produces contains a calculation question, so there is
   nothing to reverse.

Resolved (kept here so the questions don't get re-litigated): **date subtypes**
are fully recoverable — `TYPE_MAPPINGS[type].dateFormat` is a genuine 1:1 hint
(`time` sets `HH:MM`, `date` sets none), read back from the TSV's `date_format`
column, and `datetime` no longer exists as a separate type (consolidated into
`date`). **Names and answer codes** need no reversal at all: strict validation
(`XLSValidator.validateNamesAndCodes`, default-on) means an XLSForm's names are
already LimeSurvey-legal, so the TSV carries them verbatim — there is no
sanitization to undo.

## Tests

| Suite | Covers |
| --- | --- |
| `src/test/pipelines/lstsv2xlsform/toXlsform.test.ts` | feature-level reconstruction (20 cases) |
| `src/test/pipelines/lstsv2xlsform/reverseExpressions.test.ts` | relevance and constraint each table-round-tripped through the real forward transpiler as an oracle, plus direct checks on the rejection paths |
| `src/test/contract/lstsv2xlsformRoundtrip.test.ts` | all 13 registry fixtures: committed `tsv.tsv` → XLSForm vs the original `xlsform.json`, with losses 1 and 2 above normalized away and everything else compared exactly |
| `src/test/contract/fullRoundtrip.test.ts` | `constraint`, `required`, `default` and both `selected()` forms through the **real** `xlsform2lstsv` → `lstsv2xlsform` pipeline — no fixture uses them, and this is the only coverage that isn't hand-built row arrays |
