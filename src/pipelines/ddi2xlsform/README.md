# ddi2xlsform

DDI Codebook 2.5 → XLSForm sheets `{ survey, choices, settings }` (#154).

```ts
import { ddiToXlsform } from '@correlaid/formtransform';

const { survey, choices, settings } = ddiToXlsform(xml, {
  onWarning: (w) => console.warn(w.code, w.message),
});
```

CLI: `formtransform ddi2xlsform codebook.xml -o form.json`.

The XML is parsed into the Instrument (`src/instrument/fromDdi.ts`, with the
dependency-free reader `src/utils/xmlParse.ts`), then written by the XLSForm
emitter `lstsv2xlsform` uses too (`src/xlsform/fromInstrument.ts`).

## What it reads

Standard DDI first, `cdl:` notes where DDI has no element
(`convention:ddiFields`, `convention:logicMapping` `ddiEncoding`):

| XLSForm | DDI |
|---|---|
| type | `qstn/@responseDomainType`; `varFormat/@category` (date, time); `var/@dcml="0"` (integer); `valrng` without a constraint (range); `concept/@vocab` (`select_*_from_file`); the `or_other` shorthand: `cdl:or_other` |
| label / hint / guidance_hint | `qstnLit` / `postQTxt` / `ivuInstr`, every `xml:lang` |
| a note row before a question | its `preQTxt` (a grid member's is the grid's text) or its group's untyped `notes`; the rows' names in `cdl:note_names` |
| a note row with no question after it in its group | `stdyDscr/notes[@type='instruction']`, placed by `cdl:position` |
| a note row's hint, relevant, appearance | `cdl:row_hint`, `cdl:row_relevant`, `cdl:row_appearance` on `stdyDscr` |
| rows without data (`start`, `deviceid`, …, a matrix header) | `cdl:row` (the type cell) and `cdl:row_label` on `stdyDscr`, placed by `cdl:position` |
| choices | `catgry` (`catValu`, `labl`); a select_multiple's binary `var`s; the list's name in `cdl:list` when it isn't the question's; a select_multiple pair's other label in `cdl:other_label` |
| groups | `varGrp type="section"` / `"grid"`, nested by `@varGrp`; label `txt`, hint `cdl:hint`; a group of notes only placed by `cdl:position` |
| order | `var` order, `qstn/@seqNo` |
| relevant, constraint, constraint_message, required | `cdl:relevant`, `cdl:constraint`, `cdl:constraint_message`, `cdl:required` |
| default, appearance, parameters | `cdl:default`, `cdl:appearance`, `cdl:parameters` (a range's bounds also `valrng/range`) |
| exclusive | `cdl:exclusive` on the select_multiple's `varGrp` |
| settings | `titl` (+ `parTitl` per language), `IDNo`, `verStmt/version`, `codeBook/@xml:lang`, every other setting a `cdl:setting` |
| language columns | `xml:lang`; the form's name for each (`label::Deutsch (de)`) in `cdl:language` |

## Input it accepts

- **A codebook formtransform wrote** gives back its form, up to the losses
  below. Its XLSForm converts back to the same codebook, and to the same
  LimeSurvey TSV as the original form (see Tests).
- **Any other DDI** is never refused. It is read as far as its standard
  elements go. Without `qstn/@seqNo` or any `cdl:` note it is not a CDL
  codebook: identical category sets come back as one list, and each field
  only CDL carries gets one `ddi-field-missing` warning. An unknown
  `responseDomainType` is read as text (`ddi-type-unknown`).
- **A fragment**, i.e. a `<dataDscr>` or bare `<var>` / `<varGrp>` elements, is
  read the same way. A `varGrp` that refers to a `var` outside the fragment
  gets `ddi-reference-outside`.
- XML that is not well-formed, or holds neither a `codeBook` nor a `var`,
  throws `ddi-invalid`.

## Known losses

What a CDL codebook doesn't give back (`canonicalInstrument.ts` folds these
out):

1. **Rows no registry type covers** (`calculate`, …) and **groups with
   nothing in them**.
2. **Columns the model doesn't lift**: on the survey sheet (media,
   `calculation`, `choice_filter`, …), on the choices sheet every column but
   `exclusive`. Settings that are neither a string nor a number.
3. **A group without a label** comes back labelled with its name.
4. **A `constraint_message` without a `constraint`** is not in the DDI.
5. **Cell spellings**: `required` is `yes` or absent, a `guidance_hint` inside
   `parameters` comes back as the `guidance_hint` column, whitespace in the
   type cell and `parameters` is one space.
6. **Consecutive note rows** before a question are split back at the blank
   lines that joined them. A note whose text has a blank line itself, or a
   language only some of them have, gives the whole text to the first.

## Tests

- `tests/ts/contract/ddiRoundtrip.test.ts`, on every whole-survey fixture and
  registry entity: XLSForm → DDI → Instrument and XLSForm → DDI → XLSForm give
  the form back, and DDI → XLSForm → DDI gives the same codebook, byte for
  byte.
- `tests/ts/contract/lstsvDdiRoundtrip.test.ts`, through LimeSurvey: a TSV →
  DDI → Instrument is the TSV's own; XLSForm → LimeSurvey → DDI → XLSForm is
  XLSForm → LimeSurvey → XLSForm; XLSForm → DDI → XLSForm → LimeSurvey is
  XLSForm → LimeSurvey, byte for byte.
- `tests/ts/contract/ddiRoundtripGenerated.test.ts`: all of these on random
  forms (fast-check, 200 per property; `FT_ROUNDTRIP_RUNS` for more).
- Every survey's output is pinned as `ddi2xlsform.json` and validated with
  pyxform.
