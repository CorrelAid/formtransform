/**
 * `formtransform kobo list|pull|transform` — port of survey2ddi's `kobo2ddi`.
 *
 * Output layout matches the Python CLI so existing scripts and caches keep
 * working: `<out>/<uid>/{form.xlsx,submissions.json}` from `pull`, plus
 * `<uid>.xml` and `<uid>.csv` from `transform`. The client is created lazily,
 * so a cached `transform` needs no token.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROG,
  die,
  emit,
  loadXlsform,
  parse,
  readResponses,
  xlsformToDdi,
} from '../cliShared.js';
import type { ParsedValues } from '../cliShared.js';
import type { Submission } from '../pipelines/xlsform2ddi/index.js';

import { KOBO_DEFAULT_SERVER, KoboClient } from './kobo.js';

const CONNECTION_HELP = `Connection (any subcommand):
      --token <token>        API token (default: $KOBO_API_TOKEN)
      --server-url <url>     Server (default: $KOBO_SERVER_URL, then ${KOBO_DEFAULT_SERVER})

Tip: node --env-file=.env $(which ${PROG}) kobo … reads an existing .env file.`;

function koboHelp(): void {
  process.stdout.write(`${PROG} kobo — KoboToolbox API → DDI

Usage:
  ${PROG} kobo <subcommand> [options]

Subcommands:
  list                    List the assets (surveys) the token can see
  pull <uid>              Download form.xlsx + submissions.json
  transform <uid>         Pull (if not cached) and emit <uid>.xml + <uid>.csv

Run "${PROG} kobo <subcommand> --help" for its options.

${CONNECTION_HELP}
`);
}

function listHelp(): void {
  process.stdout.write(`${PROG} kobo list — list KoboToolbox assets

Usage:
  ${PROG} kobo list [--token …] [--server-url …]

Prints one line per asset: uid, deployed/draft, name.

${CONNECTION_HELP}
`);
}

function pullHelp(): void {
  process.stdout
    .write(`${PROG} kobo pull — download an asset's form and submissions

Usage:
  ${PROG} kobo pull <uid> [-o dir]

Writes <dir>/<uid>/form.xlsx and <dir>/<uid>/submissions.json.

Options:
  -o, --output <dir>         Output directory (default: output)
  -h, --help                 Show this help

${CONNECTION_HELP}
`);
}

function transformHelp(): void {
  process.stdout
    .write(`${PROG} kobo transform — asset → DDI-Codebook XML + data CSV

Usage:
  ${PROG} kobo transform <uid> [-o dir] [options]

Uses <dir>/<uid>/form.xlsx and submissions.json when present (pulling them
otherwise) and writes <dir>/<uid>/<uid>.xml and <dir>/<uid>/<uid>.csv.

Options:
  -o, --output <dir>         Output directory (default: output)
      --refresh              Re-download even if form and submissions are cached
      --data <file>          Use a Kobo CSV/JSON export instead of submissions.json
                             (XML values and headers)
      --title <text>         Study title (default: settings form_title, then the
                             asset name from the API, then the uid)
      --prod-date <date>     Override the prodDate (ISO YYYY-MM-DD; default: today)
  -h, --help                 Show this help

${CONNECTION_HELP}
`);
}

const CONNECTION_OPTIONS = {
  token: { type: 'string' },
  'server-url': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

/** Lazily build one client from flags, falling back to the env vars. */
function clientFactory(values: ParsedValues): () => KoboClient {
  let client: KoboClient | undefined;
  return () => {
    if (!client) {
      try {
        client = new KoboClient({
          token: (values.token as string) || process.env.KOBO_API_TOKEN || '',
          serverUrl:
            (values['server-url'] as string) || process.env.KOBO_SERVER_URL,
        });
      } catch (err) {
        die((err as Error).message);
      }
    }
    return client;
  };
}

function onlyUid(positionals: string[], usage: () => void): string {
  if (positionals.length === 0) {
    usage();
    die('missing asset uid');
  }
  if (positionals.length > 1) {
    die(`unexpected extra arguments: ${positionals.slice(1).join(', ')}`);
  }
  return positionals[0];
}

async function cmdList(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, CONNECTION_OPTIONS);
  if (values.help) return listHelp();
  if (positionals.length > 0)
    die(`unexpected arguments: ${positionals.join(', ')}`);

  const assets = await clientFactory(values)().listAssets();
  if (assets.length === 0) {
    process.stderr.write('No assets found.\n');
    return;
  }
  for (const a of assets) {
    const state = a.has_deployment ? 'deployed' : 'draft';
    process.stdout.write(`  ${a.uid}  ${state.padEnd(10)}  ${a.name}\n`);
  }
}

/** Download form.xlsx + submissions.json into `<outDir>/<uid>/`. */
async function pullAsset(
  client: KoboClient,
  uid: string,
  outDir: string,
): Promise<string> {
  const dir = join(outDir, uid);
  // Fetch both before writing, so a failed request leaves no half-pull.
  const [submissions, form] = await Promise.all([
    client.getSubmissions(uid),
    client.downloadXlsform(uid),
  ]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'submissions.json'),
    JSON.stringify(submissions, null, 2) + '\n',
  );
  writeFileSync(join(dir, 'form.xlsx'), form);
  process.stderr.write(
    `Saved ${submissions.length} submissions and form.xlsx to ${dir}\n`,
  );
  return dir;
}

async function cmdPull(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    ...CONNECTION_OPTIONS,
    output: { type: 'string', short: 'o' },
  });
  if (values.help) return pullHelp();
  const uid = onlyUid(positionals, pullHelp);
  await pullAsset(
    clientFactory(values)(),
    uid,
    (values.output as string) || 'output',
  );
}

/** Where `transform` reads and writes for one asset. */
interface AssetPaths {
  uid: string;
  outDir: string;
  dir: string;
  form: string;
  submissions: string;
}

/**
 * Make sure the form (and, without `--data`, the submissions) are on disk,
 * pulling what is missing or everything on `--refresh`; return the rows.
 */
async function loadSubmissions(
  client: () => KoboClient,
  paths: AssetPaths,
  dataPath: string | undefined,
  refresh: boolean,
): Promise<Submission[]> {
  if (dataPath) {
    const rows = readResponses(dataPath);
    if (refresh || !existsSync(paths.form)) {
      mkdirSync(paths.dir, { recursive: true });
      writeFileSync(paths.form, await client().downloadXlsform(paths.uid));
    }
    return rows;
  }
  if (refresh || !existsSync(paths.form) || !existsSync(paths.submissions)) {
    await pullAsset(client(), paths.uid, paths.outDir);
  }
  return readResponses(paths.submissions);
}

/**
 * `--title`, else the form's own `form_title` (left to the emitter), else the
 * asset name from the API — or the uid when working offline from `--data`.
 */
async function resolveTitle(
  explicit: string | undefined,
  formTitle: unknown,
  client: () => KoboClient,
  uid: string,
  offline: boolean,
): Promise<string | undefined> {
  if (explicit) return explicit;
  if (typeof formTitle === 'string' && formTitle.trim()) return undefined;
  if (offline) return uid;
  return (await client().getAsset(uid)).name || uid;
}

async function cmdTransform(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    ...CONNECTION_OPTIONS,
    output: { type: 'string', short: 'o' },
    refresh: { type: 'boolean', default: false },
    data: { type: 'string' },
    title: { type: 'string' },
    'prod-date': { type: 'string' },
  });
  if (values.help) return transformHelp();
  const uid = onlyUid(positionals, transformHelp);
  const client = clientFactory(values);
  const outDir = (values.output as string) || 'output';
  const dir = join(outDir, uid);
  const paths: AssetPaths = {
    uid,
    outDir,
    dir,
    form: join(dir, 'form.xlsx'),
    submissions: join(dir, 'submissions.json'),
  };
  const dataPath = values.data as string | undefined;

  const submissions = await loadSubmissions(
    client,
    paths,
    dataPath,
    values.refresh as boolean,
  );
  // Kobo forms are not bound for LimeSurvey, so the LimeSurvey name subset
  // does not apply (survey2ddi never checked it either).
  const data = loadXlsform(readFileSync(paths.form), true);
  const title = await resolveTitle(
    values.title as string | undefined,
    data.settingsData[0]?.form_title,
    client,
    uid,
    Boolean(dataPath),
  );

  let result: { xml: string; csv?: string };
  try {
    result = xlsformToDdi(data, submissions, {
      assetName: title,
      datasetFilename: `${uid}.csv`,
      prodDate: values['prod-date'] as string | undefined,
    });
  } catch (err) {
    return die(`conversion failed: ${(err as Error).message}`);
  }
  emit(result.xml, join(dir, `${uid}.xml`));
  emit(result.csv ?? '', join(dir, `${uid}.csv`));
}

/** Entry for `formtransform kobo …`. */
export async function cmdKobo(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  try {
    switch (sub) {
      case 'list':
        return await cmdList(rest);
      case 'pull':
        return await cmdPull(rest);
      case 'transform':
        return await cmdTransform(rest);
      case undefined:
      case '-h':
      case '--help':
        koboHelp();
        if (!sub) process.exit(1);
        return;
      default:
        koboHelp();
        die(`unknown kobo subcommand: ${sub}`);
    }
  } catch (err) {
    die((err as Error).message);
  }
}
