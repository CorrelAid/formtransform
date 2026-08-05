/**
 * Registry conformance: XLSForm → LimeSurvey TSV.
 *
 * Ported from the retired tests/transformations/test_xlsform_to_lstsv.py and the TSV half
 * of test_snapshots.py. Asserts converter output against the registry
 * contract (registry/root.jsonld + registry/entities/<slug>/definition.jsonld) — never
 * against literal expected values. Snapshot tests compare byte-for-byte
 * against committed tsv.tsv (blessed via `npm run bless -- tsv`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index';
import { resolveFileChoices } from '../../../src/fileChoices';
import { parseTSV, findRowsByClass, findRowByName, TSVRow } from '../unit/helpers';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const VOCAB_DIR = path.join(REPO_ROOT, 'registry', 'vocab');

// ---------------------------------------------------------------------------
// Registry loading — root graph + per-type definition.jsonld (same walk as codegen)
// ---------------------------------------------------------------------------

type RegistryEntry = Record<string, any>;

function loadRegistry(): RegistryEntry[] {
  // Same aggregation as codegen.load_registry: root graph + every split source
  // (schema.jsonld + conventions/*.jsonld + registry/<slug>/definition.jsonld).
  const graph: RegistryEntry[] = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'registry', 'root.jsonld'), 'utf-8'),
  )['@graph'];

  const splitFiles = [
    'registry/schema.jsonld',
    ...fs
      .readdirSync(path.join(REPO_ROOT, 'registry', 'conventions'))
      .sort()
      .map((s) => `registry/conventions/${s}`),
    ...fs
      .readdirSync(path.join(REPO_ROOT, 'registry', 'entities'))
      .sort()
      .map((s) => `registry/entities/${s}/definition.jsonld`),
  ];
  for (const rel of splitFiles) {
    const abs = path.join(REPO_ROOT, rel);
    if (fs.existsSync(abs)) {
      graph.push(...JSON.parse(fs.readFileSync(abs, 'utf-8'))['@graph']);
    }
  }
  return graph;
}

const REGISTRY = loadRegistry();

const questionTypes = REGISTRY.filter((e) => e['@type'] === 'QuestionType');

const lsSupported = questionTypes.filter(
  (e) => e.limesurvey?.typeCode && e.limesurvey?.supported !== false,
);

// Every entity carrying a worked example (type default, variant, composite).
const exampleEntities = REGISTRY.filter((e) => e.exampleDir);

// Only examples whose xlsform uses exclusively LS-supported XLSForm types.
// (e.g. the *_long_list examples use select_*_from_file, which LS TSV can't
// express — excluded here so they don't produce spurious failures.)
const lsUnsupportedTypeStrings = new Set(
  questionTypes
    .filter((e) => e.limesurvey?.supported === false)
    .map((e) => e.xlsform.typeString),
);
const lsSupportedVariants = exampleEntities.filter((v) =>
  loadExample(v).survey.every((row) => {
    const baseType = String(row.type ?? '').split(/\s+/)[0];
    return !lsUnsupportedTypeStrings.has(baseType);
  }),
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface XLSFormInput {
  survey: Record<string, any>[];
  choices: Record<string, any>[];
  settings?: Record<string, any>[];
}

/** Build a 1-question XLSForm for a QuestionType. */
function minimalForm(qt: RegistryEntry): XLSFormInput {
  const xlsType: string = qt.xlsform.typeString;
  if (qt.xlsform.requiresListName) {
    return {
      survey: [{ type: `${xlsType} mylist`, name: 'q1', label: 'Question 1' }],
      choices: [
        { list_name: 'mylist', name: 'a', label: 'Option A' },
        { list_name: 'mylist', name: 'b', label: 'Option B' },
      ],
    };
  }
  return {
    survey: [{ type: xlsType, name: 'q1', label: 'Question 1' }],
    choices: [],
  };
}

/** Load the source xlsform.json from a QuestionTypeVariant's example dir. */
function loadExample(variant: RegistryEntry): XLSFormInput {
  const raw = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, variant.examplePath), 'utf-8'),
  );
  return {
    survey: raw.survey ?? [],
    choices: raw.choices ?? [],
    settings: raw.settings ?? [],
  };
}

/** Convert with the same call shape the blessed snapshots use. */
async function convertRaw(input: XLSFormInput): Promise<string> {
  const converter = new XLSFormToTSVConverter();
  return converter.convert(
    input.survey,
    input.choices,
    input.settings ?? [],
    resolveFileChoices(input.survey, VOCAB_DIR),
  );
}

async function convertRows(input: XLSFormInput): Promise<TSVRow[]> {
  return parseTSV(await convertRaw(input));
}

const questionRows = (rows: TSVRow[]) => findRowsByClass(rows, 'Q');

// ---------------------------------------------------------------------------
// Minimal forms per LS-supported QuestionType
// ---------------------------------------------------------------------------

describe('registry conformance: minimal forms', () => {
  it.each(lsSupported.map((qt) => [qt['@id'], qt]))(
    '%s: emits Q row with registry typeCode',
    async (_id, qt) => {
      const rows = await convertRows(minimalForm(qt));
      const qrows = questionRows(rows);
      expect(qrows.length, `${qt['@id']}: no Q rows emitted`).toBeGreaterThan(
        0,
      );

      const q1 = findRowByName(qrows, 'q1');
      expect(q1, `${qt['@id']}: no row name=q1`).toBeDefined();
      expect(q1!['type/scale']).toBe(qt.limesurvey.typeCode);
    },
  );

  it.each(
    lsSupported
      .filter((qt) => qt.limesurvey?.supportsOther)
      .map((qt) => [qt['@id'], qt]),
  )('%s: or_other input → other=Y', async (_id, qt) => {
    const input = minimalForm(qt);
    input.survey[0].type = `${input.survey[0].type} or_other`;
    const rows = await convertRows(input);

    const q1 = findRowByName(questionRows(rows), 'q1');
    expect(q1).toBeDefined();
    expect(
      q1!.other,
      `${qt['@id']}: supportsOther=true + or_other input → expected other=Y`,
    ).toBe('Y');
  });
});

// ---------------------------------------------------------------------------
// Presentation variant examples
// ---------------------------------------------------------------------------

describe('registry conformance: variant examples', () => {
  it.each(lsSupportedVariants.map((v) => [v['@id'], v]))(
    '%s: example produces Q rows',
    async (_id, variant) => {
      const rows = await convertRows(loadExample(variant));
      expect(
        questionRows(rows).length,
        `${variant['@id']}: example produced zero Q rows`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(
    lsSupportedVariants
      .filter((v) => v.presentation?.withOther)
      .map((v) => [v['@id'], v]),
  )('%s: withOther → some Q row has other=Y', async (_id, variant) => {
    const rows = await convertRows(loadExample(variant));
    const hasOther = questionRows(rows).some((r) => r.other === 'Y');
    expect(
      hasOther,
      `${variant['@id']}: withOther=true but no Q row has other=Y`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Frozen TSV snapshots — bless via `npm run bless -- tsv`
// ---------------------------------------------------------------------------

const snapshotVariants = exampleEntities.filter((v) =>
  fs.existsSync(path.join(REPO_ROOT, v.exampleDir, 'tsv.tsv')),
);

describe('registry conformance: TSV snapshots', () => {
  it.each(snapshotVariants.map((v) => [v['@id'], v]))(
    '%s: converter output matches committed tsv.tsv',
    async (_id, variant) => {
      const snapshot = fs.readFileSync(
        path.join(REPO_ROOT, variant.exampleDir, 'tsv.tsv'),
        'utf-8',
      );
      const observed = await convertRaw(loadExample(variant));
      expect(
        observed,
        `${variant['@id']}: TSV drifted from blessed snapshot. ` +
          `If the converter change is intentional, re-bless: ` +
          `npm run bless -- tsv`,
      ).toBe(snapshot);
    },
  );
});
