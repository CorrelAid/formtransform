# From survey responses to a DDI codebook + data file

formtransform turns a survey definition plus its responses into two files:

- a **DDI-Codebook 2.5 XML** describing every variable, with `<caseQnty>` set to
  the number of responses
- a **data CSV** whose header matches the XML's `<var name="">` elements one to
  one, in the same order

formtransform does not talk to Kobo or LimeSurvey. You export the responses from
the platform yourself, then convert them, either with the CLI or in the
browser with the library.

## 1. Export from the platform

### KoboToolbox

1. **Form:** *Form → ⋯ → Download XLS*. Despite the name, you get an `.xlsx`
   file, which is fine.
2. **Data:** *Data → Downloads*, type **CSV** (or **JSON**), with
   - **Value and header format: XML values and headers.** The CSV then carries
     choice codes rather than labels, and question names (`group/name`) rather
     than question text. With or without group names in the headers both
     work.
   - Any delimiter: `;` (Kobo's default) and `,` are both detected.

### LimeSurvey

1. **Structure:** the survey-structure `.tsv`, i.e. the file `formtransform
   xlsform2lstsv` produced, or the survey's *Export → Tab-separated-values
   format (.txt)*.
2. **Responses:** *Responses → Export*, format **CSV** (or JSON), with
   - **Headings: Question code** (`q`, `q[sub]`)
   - **Responses: Answer codes**, *not* full answers. The codebook's
     categories hold answer codes, so an export with answer texts (`Ja`,
     `Fortgeschritten`) produces data that doesn't match them.

LimeSurvey's export quirks are handled for you: underscores stripped from codes,
option codes truncated to 5 characters, arrays as `array[sq]`, and the native
"other" (`-oth-`, `q[other]`). See
[`src/pipelines/README.md`](src/pipelines/README.md#the-ddi-data-file).

## 2. Convert

### Command line

```bash
# Kobo / any XLSForm
npx github:CorrelAid/formtransform xlsform2ddi form.xlsx -o codebook.xml --data export.csv

# LimeSurvey
npx github:CorrelAid/formtransform lstsv2ddi survey.tsv -o codebook.xml --data export.csv
```

Both write `codebook.xml` and `data.csv` beside it. Options:

- `--data-out <file>` puts the CSV elsewhere, and its name is what
  `<fileDscr>` records.
- `--dataset-filename <name>` renames both: the recorded name and the file
  written beside the XML.

With the XML on stdout (no `-o`), `--data-out` is required.

`xlsform2ddi` checks the form against the LimeSurvey-compatible name subset by
default. A Kobo form with names like `full_name` needs `--skip-validation`. The
DDI output does not rename anything.

### In the browser

Everything exported from `@correlaid/formtransform` is browser-safe: no
filesystem, no network. With files from an `<input type="file">`:

```typescript
import {
  XLSLoader,
  parseResponses,
  buildDdiXml,
  buildDataCsv,
  extractVariables,
  choicesByListFromRows,
  lstsvToDdiXml,
  lstsvToDataCsv,
} from '@correlaid/formtransform';

// Kobo / XLSForm
const form = XLSLoader.parseXLSData(await formFile.arrayBuffer(), {
  skipValidation: true, // the LimeSurvey name subset doesn't apply to DDI
});
const rows = parseResponses(await dataFile.text(), dataFile.name);
const xml = buildDdiXml(form.surveyData, form.choicesData, {
  settings: form.settingsData[0],
  submissions: rows,
});
const csv = buildDataCsv(
  extractVariables(form.surveyData, choicesByListFromRows(form.choicesData)),
  rows,
);

// LimeSurvey
const tsv = await tsvFile.text();
const lsRows = parseResponses(await dataFile.text(), dataFile.name);
const lsXml = lstsvToDdiXml(tsv, { submissions: lsRows });
const lsCsv = lstsvToDataCsv(tsv, lsRows, {
  onWarning: (msg) => console.warn(msg), // option codes missing from the TSV
});
```

`parseResponses` accepts CSV (`;` or `,`, quoted multi-line fields, BOM) or a
JSON array of objects. It decides by file extension, falling back to sniffing
the content.

## 3. Read the codebook back in Python

[`examples/python/ddi_reader.py`](examples/python/ddi_reader.py) is a
short, stdlib-only reader to copy into an analysis project. It replaces
survey2ddi's `survey2ddi_core.ddi`.

```python
import pandas as pd
from ddi_reader import variable_labels, value_labels, apply_value_labels

labels = variable_labels("codebook.xml")   # {"age": "Age", ...}
codes = value_labels("codebook.xml")       # {"gender": {"male": "Male", ...}}

df = pd.read_csv("data.csv", dtype=str, keep_default_na=False)
df = apply_value_labels(df, "codebook.xml")  # codes → labels
```

`select_multiple` binary columns (`<question>_<choice>`) stay `0`/`1`: their
categories carry no labels. Use `variable_labels` for their meaning.
`tests/validation/test_ddi_reader.py` runs the reader against the blessed DDI
snapshots.

## survey2ddi

[survey2ddi](https://github.com/CorrelAid/survey2ddi) is retired, and this page
covers everything it did. It had these commands:

- `kobo2ddi` / `limesurvey2ddi transform` → the CLI commands above
- their `pull` commands → the platform exports in step 1
- its DDI reader → step 3

One difference for LimeSurvey: survey2ddi exported answer *texts*, which never
matched its own codebook. Export answer codes as described above.
