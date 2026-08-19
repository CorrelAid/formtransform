# Handover: making formtransform-app run entirely on this library

Audience: whoever (person or agent) picks up
[`CorrelAid/formtransform-app`](https://github.com/CorrelAid/formtransform-app)
next. This document is the plan; the work is split into issues in that repo,
linked below. Each issue is written to stand on its own — an agent should be able
to act on one without reading the others.

## Goal

The app is a SvelteKit static site (bun, `adapter-static`, 100% client-side) that
today converts surveys with **two unrelated engines**:

| Path in the app | Engine today | Where it should end up |
|---|---|---|
| XLSForm → LimeSurvey TSV | `xlsform2lstsv@0.3.0` (old npm package) | `@correlaid/formtransform` |
| Kobo → DDI, metadata only | Pyodide + `survey2ddi` wheel (CPython in WASM) | `@correlaid/formtransform` |
| Kobo → DDI, full (with responses CSV) | Pyodide + `survey2ddi` wheel | blocked — see [gap](#the-one-real-gap) |
| LimeSurvey → DDI | Pyodide, backend only, unreachable in the UI | decide: implement or delete |

End state: one dependency, `@correlaid/formtransform`, installed from
`github:CorrelAid/formtransform`; no Pyodide, no Python wheel, no `xlsform2lstsv`.
Every type decision the app makes then comes from this repo's `registry/`, which
is the point of the consolidation.

## What this library gives the app

Verified against `src/index.ts` at the time of writing. All importable from the
package root:

- `XLSFormParser.convertXLSDataToTSV(data: Buffer | ArrayBuffer, config?: Partial<ConversionConfig>): Promise<string>`
  — XLSForm bytes → LimeSurvey structure TSV. **Same class, method and signature
  as the old `xlsform2lstsv` package**, so the app's TSV tab is a one-line import
  swap.
- `XLSLoader.parseXLSData(data, { skipValidation? }): { surveyData, choicesData, settingsData, … }`
  — parse a workbook into row arrays. Validates against the supported XLSForm
  subset by default and throws on violations.
- `buildDdiXml(surveyRows, choices, options?): string` — XLSForm rows →
  DDI-Codebook 2.5 XML. `choices` takes the flat `choicesData` array directly.
  Options: `assetName`, `settings`, `submissions`, `datasetFilename`, `prodDate`.
- `lstsvToDdiXml(tsv: string, options?): string` — LimeSurvey structure TSV →
  DDI XML. **This did not exist when the migration was first sketched; it does
  now**, which is what makes the dormant LimeSurvey → DDI tab decidable.
- `lstsvToXlsform(...)`, `validateLstsvSubset(...)`, `ConfigManager`,
  `defaultConfig` — available, not currently needed by the app.

Browser-safety: the Node-only modules (`src/cli.ts`, `src/fileChoices.ts`, the
only places that touch `node:fs`) are deliberately **not** re-exported from
`src/index.ts`. The browser entry pulls in only `xlsx`, `js-xpath` and `marked`.
If a bundler ever reports `node:fs` from this package, that is a regression here,
not something for the app to shim.

Config parity: the app's five conversion toggles (`convertWelcomeNote`,
`convertEndNote`, `convertOtherPattern`, `convertMarkdown`, `hideNoAnswer`) all
exist in `ConversionConfig` with the same names. The library additionally offers
`hideQuestionTips` (default `true`), which the app does not expose yet.

## The one real gap

`buildDdiXml` emits DDI **metadata**. Given `submissions` it uses only their
*count*, for `<caseQnty>`:

```ts
/** Response records — only their count (`caseQnty`) is used. */
submissions?: unknown[];
```

There is no TypeScript equivalent of the Python `survey2ddi_core.data.build_data_csv`,
which remaps raw response columns onto DDI variable names. So the app's Kobo → DDI
**full mode** (XLSForm + responses CSV → XML **and** `data.csv`) cannot leave
Pyodide, and Pyodide cannot be deleted, until this library grows a response-data
emitter. That is tracked from the app side in issue #9, which asks for an upstream
issue against this repo.

Everything else the app does is already covered.

## The issues

Do them in this order. #7 is independent of the rest.

| # | Issue | When |
|---|---|---|
| 1 | [#4 Add `@correlaid/formtransform` and rename the app package](https://github.com/CorrelAid/formtransform-app/issues/4) | first — everything else depends on it |
| 2 | [#5 TSV tab: swap `xlsform2lstsv` for the library](https://github.com/CorrelAid/formtransform-app/issues/5) | after #4 |
| 3 | [#6 Kobo → DDI metadata mode: replace Pyodide with `buildDdiXml`](https://github.com/CorrelAid/formtransform-app/issues/6) | after #4, parallel with #5 |
| 4 | [#8 LimeSurvey → DDI: wire the dead tab to `lstsvToDdiXml`, or remove it](https://github.com/CorrelAid/formtransform-app/issues/8) | after #4 |
| 5 | [#9 Gap: no response-data CSV emitter (blocks dropping Pyodide)](https://github.com/CorrelAid/formtransform-app/issues/9) | after #6; tracking only |
| 6 | [#10 Remove Pyodide and the `survey2ddi` wheel](https://github.com/CorrelAid/formtransform-app/issues/10) | last, and only once #5, #6, #8, #9 are all done |
| — | [#7 State on the site that this is not a general-purpose converter](https://github.com/CorrelAid/formtransform-app/issues/7) | any time |

Two things worth knowing before starting #4:

- The library ships no `dist/` in git; its `prepare` script (`husky || true; npm run build`)
  compiles it at install time. The first `bun install` after adding the dependency
  must be checked for `node_modules/@correlaid/formtransform/dist/index.js` — the
  app deploys through nixpacks with `bun install --frozen-lockfile`, so a git
  dependency that fails to build locally will fail the deploy too.
- The app's `package.json` is still named `formtransform`, which shadows the
  library. #4 renames it to `formtransform-app`.

## The scope notice (#7)

Independent of the migration, and the reason it is on this list: **this is not a
general-purpose converter, and the site does not say so.**

The library validates strictly and *rejects* rather than approximates —
unregistered question types (`image`, `audio`, `geopoint`, …), unregistered
appearances, identifiers over the sanitisation limits, nesting deeper than three
levels, selects without an explicit `list_name`, LimeSurvey reserved words. See
[Supported XLSForm Subset](README.md#supported-xlsform-subset). Someone arriving
with an arbitrary XLSForm will hit an error and read it as a bug; saying so up
front turns that error into an expected outcome.

Two surfaces need it, and #7 carries the drafted EN + DE copy for both:

1. **In the app** — a callout on `/` between the `<h1>` and the tab bar, strings
   in `src/lib/i18n.ts`. It has to live in the app's own i18n, not in the fetched
   CDL content: the `cdl-content` Vite plugin silently falls back to an empty
   string when its GitHub fetch fails (no token, rate limit), and a disclaimer
   that can vanish is not a disclaimer.
2. **On the CDL site** — `CorrelAid/cdl-wp-eins`, at
   `src/content/snippets/formtransform/{en,de}.html`, fetched at build time. That
   snippet is also factually stale: it still credits `xlsform2lstsv` and mentions
   only the LimeSurvey TSV conversion.

## Hard rules for whoever does the work

- **Do not modify this repo (`CorrelAid/formtransform`) from the app side.** Missing
  capability → open an issue here.
- **Do not reimplement conversion logic in the app.** The app is a file picker, a
  progress spinner and a download button. Every type decision belongs to the
  registry.
- **Keep the TSV output byte-identical.** It feeds a real LimeSurvey import. The
  diff in issue #5 is the acceptance test, and a difference is a finding to
  report, not something to paper over.
- **Do not delete a working feature to reach a green grep.** Full-mode Kobo → DDI
  stays on Pyodide until this library can replace it.
- **Keep the library's validation on.** `skipValidation` exists for callers that
  have already validated; an app that passes it turns a clear rejection into
  silently wrong output.

## Related documents

- [`README.md`](README.md) — what this repo ships and to whom
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — registry → codegen → artifacts, and why
  DDI is the terminus of the pipeline graph
- `src/pipelines/lstsv2xlsform/README.md` — the documented losses on the reverse
  path, relevant if the app ever exposes it
