# Real KoboToolbox exports

What KoboToolbox 2.026.23 (kobo.correlaid.org) exported after `../xlsform.json`
was deployed (as an `.xlsx`) and five test cases were submitted through its
OpenRosa `/submission` endpoint, on 2026-09-26. See
[`../../all_types_survey/kobo/README.md`](../../all_types_survey/kobo/README.md)
for what each file is and how it was anonymised.

`other_comments` is empty in every case: its `relevant` compares
`satisfaction_level` with `'unhappy'`, which is not one of its choice codes
(`unhp`), so a respondent never sees it.

The asset (`formtransform-fixture-complex_survey`) is kept, archived, in the
owner's account.
