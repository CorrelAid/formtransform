# Real KoboToolbox exports

What KoboToolbox 2.026.23 (kobo.correlaid.org) exported after `../xlsform.xlsx`
was deployed and six test cases were submitted through its OpenRosa
`/submission` endpoint, on 2026-09-26. Kobo stores those like Enketo entries,
so `_uuid`, `_submission_time`, `grp/q` keys and the export shapes are Kobo's
own. `tests/ts/contract/koboRealExports.test.ts` reads every file here.

| File | Kobo export |
|---|---|
| `data.json` | `/api/v2/assets/<uid>/data/?format=json` (the *JSON* download) |
| `summary_flat.csv` | CSV, XML values and headers, multiple select as a single column, no group names |
| `summary_grouped.csv` | same, with group names (`grp/q`) |
| `details_flat.csv` | CSV, multiple select as separate columns (`q/opt` = `1`/`0`) |
| `details_grouped.csv` | same, with group names (`grp/q/opt`) |
| `both_flat.csv` | CSV, multiple select as both a single column and separate columns |
| `both_grouped.csv` | same, with group names |

The answers are invented (example.org addresses, `+49 000` numbers).
Anonymised: the submitting account in `_submitted_by` is replaced by
`fixture-user`. The case list covers an all-empty minimal case, an empty
multiple, "other" in both `or_other` questions, and text with commas, quotes,
semicolons, tabs, newlines, umlauts and an emoji.

The asset (`formtransform-fixture-all_types_survey`) is kept, archived, in the
owner's account so the exports can be pulled again if Kobo's format changes.
