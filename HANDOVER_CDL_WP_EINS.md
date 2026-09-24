# Handover: adjusting cdl-wp-eins after the formtransform consolidation

Audience: whoever (person or agent) edits
[`CorrelAid/cdl-wp-eins`](https://github.com/CorrelAid/cdl-wp-eins) — the Astro
site behind `umfragen.civic-data.de` (Werkstattbox 1, Umfragenwerkstatt).

Unlike the other handover documents in this repo, this one is **not** about making
a repo consume the library. cdl-wp-eins is upstream of the ecosystem in two ways
that both went stale when `xlsform2lstsv` and `survey2ddi` were consolidated into
`@correlaid/formtransform`:

1. It is the **shop window** — `/tools` and the workflow graphics tell readers
   which tools exist, and it still advertises two retired packages.
2. It is the **source of the XLSForm documentation that agents ingest** —
   `llm-xlsform.txt` and `llm-phases12-xlsform.txt` are fetched by formulaid's
   skill build, and they teach the full XLSForm specification while the CDL
   pipeline accepts a strict subset.

Companion document: [`HANDOVER_QWAC.md`](HANDOVER_QWAC.md).

## What the registry actually supports

Check every content claim against this. From `src/generated/TypeMappings.ts` in
this repo:

| Supported question types | Registered but **not** convertible | Structural |
|---|---|---|
| `text` (alias `string`), `integer` (alias `int`), `decimal`, `date`, `time`, `note`, `select_one`, `select_multiple` | `select_one_from_file`, `select_multiple_from_file` | `begin_group` / `end_group` |

Anything else — `rank`, `range`, `calculate`, `image`, `audio`, `geopoint`,
`dateTime` — is **not registered at all**: the converters reject such a form
rather than approximating it. Same for unregistered appearances, identifiers over
the sanitisation limits, group nesting deeper than three levels, and selects
without an explicit `list_name`. See
[Supported XLSForm Subset](README.md#supported-xlsform-subset).

## Verified inventory

Everything below was checked against the working copy at the time of writing.

### Retired packages still presented as current

- `src/lib/toc.json` lines 64 and 66 — tool entries `xlsform2lstsv`
  (`type: "package"`, phase 2) and `survey2ddi` (`type: "package"`, phase 3).
  Both repos are superseded by `CorrelAid/formtransform`.
- `src/content/snippets/xlsform2lstsv/{en,de}.html` and
  `src/content/snippets/survey2ddi/{en,de}.html` — the descriptions rendered for
  those entries.
- `src/pages/workflow.astro` lines 68–70 (`FormTransform (bzw. xlsform2lstsv)`),
  86 and 103 (`survey2ddi` as the DDI tool).
- `src/lib/components/EcosystemFlowchart.astro` lines 33, 44, 47 — same, in the
  ecosystem graphic.
- `src/content/pages/nachnutzbarkeit.mdx` lines 33 and 42 — names `survey2ddi` as
  *the* DDI tool, and links it as `/tools/survey2ddi`. **That link is broken:**
  `src/pages/tools/` contains only `index.astro`, so the built site has
  `/tools/index.html` and anchors (`/tools#survey2ddi`) — no per-tool pages. The
  broken URL is also baked into `dist/llm.txt`, `dist/llm-xlsform.txt` and
  `dist/llm-ddi.txt`, so agents ingest it too.
- `src/content/pages/kobotoolbox.mdx` line 6 and
  `src/content/pages/umfragetool-einladung.mdx` line 23 — `survey2ddi` by name
  and GitHub URL.
- `src/content/snippets/formtransform/{en,de}.html` — credits
  `xlsform2lstsv` as the engine, describes only the LimeSurvey TSV conversion (no
  DDI), and carries no scope caveat.

### Documentation that overshoots the subset

`src/content/pages/xlsform-standard.mdx` (919 lines) documents, as if usable:
`## Fragetypen` → `### Rang` (line 226), `### Bereich` (253),
`### Mehrfachauswahl aus Datei` (187), `## Berechnung` (523), plus
`### Externe CSV-Daten` (395). None of those convert: `rank`, `range` and
`calculate` are not in the registry at all, and `select_*_from_file` is
registered as *not* convertible.

`src/content/pages/fragetypen.mdx` is in better shape — it pulls live examples
from qwacback via `<QuestionTypeBlock exampleId="…" />` — but its ids
(`single_choice`, `single_choice_long_list`, `single_choice_other`,
`multiple_choice`, `grid`, `integer`, `text`) are a **parallel naming scheme**
next to the registry slugs (`select_one`, `select_one_long_list`,
`select_one_other`, `select_multiple`, `grid`, `integer`, `text`). Two vocabularies
for one set of things is exactly how the next mismatch gets introduced.

### The machine-readable endpoints

`src/pages/llm.txt.ts`, `llm-xlsform.txt.ts`, `llm-phases12-xlsform.txt.ts` and
`llm-ddi.txt.ts`, all thin wrappers over `buildLlmTxt(format, maxPhases?)` in
`src/lib/utils/llm-txt.ts`. `llm-phases12-xlsform.txt` (phases 1–2, XLSForm
examples) is what `scripts/build_skill.sh` in formulaid fetches into
`references/survey-methodology.md`. It therefore carries the whole
`xlsform-standard.mdx` chapter into an agent's context, next to the registry's
allowlist, with nothing marking which one binds.

### Snippet consumers — do not rename these paths

Three apps fetch snippets from this repo at build time through the GitHub API:

| App | Snippet paths fetched |
|---|---|
| formtransform-app | `formtransform/{en,de}.html`, `liability/{en,de}.html` |
| qwac | `qwac/{en,de}.html`, `liability/{en,de}.html` |
| formulaid | `formulaid/{en,de}.html`, `liability/{en,de}.html` |

None fetches `xlsform2lstsv/` or `survey2ddi/`, so those two directories can be
deleted safely. The four names above must keep working — each fetcher falls back
to an empty string on failure, so a rename does not fail a build, it silently
empties a section of the page.

## Work items

Not yet filed as issues. Each is scoped to be one PR.

### 1. One package entry instead of two retired ones

`src/lib/toc.json`: delete the `xlsform2lstsv` and `survey2ddi` entries; add one
entry `formtransform` of `type: "package"` pointing at
`https://github.com/CorrelAid/formtransform`, with `phases: [2, 3]` (it serves
both the LimeSurvey deployment step and the DDI documentation step). Keep the
existing `formtransform` **app** entry — note the id collision and pick a distinct
id for the package (e.g. `formtransform-lib`), since `/tools` renders
`id`-keyed anchors and globs snippets by id.

Add `src/content/snippets/formtransform-lib/{en,de}.html` describing the library:
one TypeScript library plus CLI, four directions (XLSForm → LimeSurvey TSV,
XLSForm → DDI, LimeSurvey TSV → DDI, LimeSurvey TSV → XLSForm), built on a
registry that defines the supported subset. Delete the two retired snippet
directories.

Verify: `bun run build`, then check `/tools` renders the new entry with text, and
that no anchor in the built HTML points at a removed id.

### 2. Fix the prose references and the broken link

`nachnutzbarkeit.mdx` (lines 33, 42), `kobotoolbox.mdx` (line 6),
`umfragetool-einladung.mdx` (lines 23, 30), `workflow.astro` (68–70, 86, 103),
`EcosystemFlowchart.astro` (33, 44, 47): name FormTransform / `formtransform`
instead of the retired packages, and fix `/tools/survey2ddi` →
`/tools#survey2ddi` (or the new package anchor).

While there: `umfragetool-einladung.mdx` line 30 says FormTransform converts
XLSForm → LimeSurvey TSV, which is true but now half the story — it also emits DDI.

Verify: `grep -rn "xlsform2lstsv\|survey2ddi" src/ | grep -v node_modules`
returns only deliberate historical mentions, if any. Then rebuild and grep
`dist/llm.txt` for the same, since these pages feed it.

### 3. Mark the out-of-subset features in the XLSForm chapter

`xlsform-standard.mdx` should stay a good XLSForm reference — it is not wrong
about XLSForm — but it must stop implying that everything it documents works in
this ecosystem. For `### Rang`, `### Bereich`, `## Berechnung`,
`### Mehrfachauswahl aus Datei` and `### Externe CSV-Daten`, add a short,
consistent admonition: not supported by the CDL pipeline, a form using it will be
rejected by FormTransform / qwacback, with a link to the supported subset.

Add the same statement once near the top of the page, so a reader who skims sees
it before the chapter.

Prefer one reusable component (an `<Unsupported>` / `<NichtUnterstützt>` MDX
component) over five hand-written paragraphs — it makes the next addition cheap
and lets item 4 find these blocks programmatically.

Verify: every heading listed above carries the marker; `bun run build` succeeds;
the marker text appears in `dist/llm-xlsform.txt` (agents must see it too).

### 4. A methodology-only llm endpoint — lets formulaid drop its heading strip

Add `src/pages/llm-phases12.txt.ts` — `buildLlmTxt('none', 2)`, i.e. phases 1–2
**without** the XLSForm examples and without the `xlsform-standard` page. The
`toc.json` section for Fragebogendesign already marks `xlsform-standard` in
`excludeFromGraphic`; the endpoint needs an equivalent exclusion for text output,
which is a small change in `getSlugsForPhases()` / `buildLlmTxt()` in
`src/lib/utils/llm-txt.ts`.

Why: formulaid ships the CDL-generated `cdl-survey-types` sub-skill as its
authoritative type reference and no longer ingests the general spec (its #9/#10,
done 2026-09-24). It gets there by fetching the combined
`llm-phases12-xlsform.txt` and deleting the `# XLSForm-Dokumentation` … `# Fragen
formulieren` range by heading (`scripts/build_skill.sh`), which breaks silently
if those headings change. A dedicated endpoint removes the guesswork.

Coordinate: once it is live, open an issue on `CorrelAid/formulaid` to switch
`LLM_METHODOLOGY_URL` to it and drop the strip. Keep the old endpoints working;
other consumers may rely on them. **Until then, don't rename those two
headings.**

Verify: `curl` the new path in `bun run dev`; assert it contains the Datenschutz
and Operationalisierung sections and **no** `# XLSForm-Dokumentation` heading.

### 5. One vocabulary for question types

Decide whether `fragetypen.mdx`'s `exampleId`s or the registry slugs are the
names, and make the other follow. The ids resolve against qwacback's seeded
examples, so start by finding where those ids come from
(`seed_data/` and `internal/examples/` in `CorrelAid/qwacback`) and record the
mapping in the PR.

Preferred direction: registry slugs everywhere, since that is what the converters,
the generated skill and the DDI output all use. If the German page wants friendlier
labels, keep the label in the prose and the slug in the `exampleId`.

This one is a coordination item, not a quick fix — file it with the mapping table
before changing anything.

### 6. Guard rails (optional, cheap)

- A link check over `dist/` in CI, which would have caught `/tools/survey2ddi`.
- A test asserting every `toc.json` tool id has a snippet directory, and every
  snippet directory a `toc.json` entry — the `/tools` page silently renders an
  empty description otherwise (`snippets[…] ?? ""`).

## Hard rules

- **Do not restate the supported subset in prose.** Link to it. A hand-copied
  list of types on the website is a third source of truth after the registry and
  the generated skill.
- **Do not rename or delete the four snippet paths** listed above. Consumers fail
  silently — an empty section, no error.
- **Headings in the llm endpoints are an interface.** formulaid's skill build
  slices by heading; changing `# XLSForm-Dokumentation` or the phase structure
  breaks it. Change them deliberately and tell that repo.
- **German is the primary language**, and EN/DE snippets must stay in sync — the
  apps render whichever locale the visitor has.
- **Registry facts belong to this repo.** If the website needs a machine-readable
  list of supported types to render, that is an upstream ask here (see the
  catalogue ask tracked in qwac #11 / formulaid #12), not a JSON file copied into
  the site.

## Related documents

- [`README.md`](README.md) — what this repo ships and to whom
- [`HANDOVER_QWAC.md`](HANDOVER_QWAC.md)
