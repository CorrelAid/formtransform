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
| type | `qstn/@responseDomainType`; `varFormat/@category` (date, time); `var/@dcml="0"` (integer); `valrng` without a constraint (range); `concept/@vocab` (`select_*_from_file`) |
| label / hint / guidance_hint | `qstnLit` / `postQTxt` / `ivuInstr`, every `xml:lang` |
| a note row before a question | its `preQTxt` (a grid member's is the grid's text) or its group's untyped `notes` |
| choices | `catgry` (`catValu`, `labl`); a select_multiple's binary `var`s |
| groups | `varGrp type="section"` / `"grid"`, nested by `@varGrp`; label `txt`, hint `cdl:hint` |
| order | `var` order, `qstn/@seqNo` |
| relevant, constraint, constraint_message, required | `cdl:relevant`, `cdl:constraint`, `cdl:constraint_message`, `cdl:required` |
| default, appearance, parameters | `cdl:default`, `cdl:appearance`, `cdl:parameters`; a range's `valrng/range` |
| exclusive | `cdl:exclusive` on the select_multiple's `varGrp` |
| settings | `titl` (+ `parTitl` per language), `IDNo`, `verStmt/version`, `codeBook/@xml:lang`, `cdl:setting` |

## Input it accepts

- **A codebook formtransform wrote** gives back its form, up to the losses
  below. `tests/ts/contract/ddiRoundtrip.test.ts` checks every fixture on the
  Instrument model, and `ddiRoundtripGenerated.test.ts` checks random forms
  (fast-check). Every survey's output is pinned as `ddi2xlsform.json` and
  validated with pyxform.
- **Any other DDI** is never refused. It is read as far as its standard
  elements go. Without `qstn/@seqNo` or any `cdl:` note it is not a CDL
  codebook, and each field only CDL carries gets one `ddi-field-missing`
  warning. An unknown `responseDomainType` is read as text
  (`ddi-type-unknown`).
- **A fragment**, i.e. a `<dataDscr>` or bare `<var>` / `<varGrp>` elements, is
  read the same way. A `varGrp` that refers to a `var` outside the fragment
  gets `ddi-reference-outside`.
- XML that is not well-formed, or holds neither a `codeBook` nor a `var`,
  throws `ddi-invalid`.

## Known losses

What a CDL codebook doesn't give back (the round-trip tests fold these out):

1. **List names.** Identical category sets come back as one list, named
   after the first question that uses it (a grid's after the grid).
2. **The `or_other` shorthand** comes back as the explicit pair (an `other`
   choice plus a `<question>_other` text question with its `relevant`), which
   behaves the same. The `other` choice's label is what LimeSurvey shows
   (`convention:other` `limesurveyOtherText`), or for a select_multiple the
   convention's label.
3. **Note rows:**
   - Their names are rebuilt as `<question>_note`.
   - Consecutive notes before one question come back as one note.
   - A note with no question after it in its group (an intro or outro) comes
     back at the end of the survey, under its own name.
   - A note's hint is lost.
4. **Rows DDI has no variable for**: device and session metadata (`start`,
   `end`, `deviceid`, …), matrix header rows, `calculate` and other
   unregistered types. A group with none of its questions left is dropped.
5. **Language names.** Columns use the BCP 47 tag (`label::de`), and
   `default_language` gets an English name (`German (de)`).
6. **Defaults are written as defaults.** A range's `start`/`end` equal to
   the registry defaults (1, 10) aren't written back. A group without a label
   comes back labelled with its name. `required` is `yes` or absent.
7. A `constraint_message` without a `constraint` is not in the DDI.
8. **Choice columns** other than `exclusive` (media, filters) and **settings**
   other than `form_title`, `form_id`, `version`, `default_language` and
   `style` are not carried.
9. **The title.** A codebook built with an explicit study title (`assetName`)
   has that title, not `form_title`.
