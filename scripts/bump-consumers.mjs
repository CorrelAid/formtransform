#!/usr/bin/env node
// Rewrite a consumer repo's formtransform pins to a new release (formtransform#172).
//
//   node scripts/bump-consumers.mjs <consumer> <version> <checkout> [--sums FILE] [--no-lock]
//   node scripts/bump-consumers.mjs --list
//
// <consumer> is one of CONSUMERS below, <checkout> a clone of that repo. Every
// pin it lists is rewritten in place: the npm tarball URL, then the lockfile
// through the repo's own package manager (npm or bun, so the lock's integrity
// and dependency entries are the manager's, not ours), and the version and
// checksum pins outside npm. Checksums come from the release's SHA256SUMS
// (downloaded, or --sums for a local copy). The consumer's own pin check runs
// last, where it has one.
//
// It fails, changing nothing, when a pin it expects is missing: a consumer
// that moved a pin must be updated here, not skipped silently. It never
// commits or pushes; the bump-consumers workflow opens the PR, or you do.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RELEASES = 'https://github.com/CorrelAid/formtransform/releases/download';
const TARBALL = new RegExp(
  `${RELEASES.replace(/[.]/g, '\\.')}/v[^/"'\\s]+/correlaid-formtransform-[^/"'\\s]+\\.tgz`,
  'g',
);

const tarballUrl = (v) => `${RELEASES}/v${v}/correlaid-formtransform-${v}.tgz`;

function sumOf(sums, file) {
  const sum = sums[file];
  if (!sum) throw new Error(`SHA256SUMS has no ${file}`);
  return sum;
}

/**
 * Per consumer: the files with pins, each a list of [pattern, replacement]
 * (every pattern must match), the npm package directories and their manager
 * (ownVersion: the package's own version field follows formtransform's, as
 * qwacback's ddi-emitter does since qwacback#71),
 * and the consumer's own consistency check.
 */
export const CONSUMERS = {
  qwacback: {
    repo: 'CorrelAid/qwacback',
    files: {
      '.registry-version': () => [[/^v\S+\s*$/, (v) => `v${v}\n`]],
      'docker-compose.yml': () => [
        [
          /(ghcr\.io\/correlaid\/schematron-worker:)v[\w.-]+/g,
          (v) => `$1v${v}`,
        ],
      ],
    },
    npm: [{ dir: 'ddi-emitter', manager: 'npm', ownVersion: true }],
    verify: ['bash', 'scripts/check-registry-version.sh'],
    // Its CI pulls the worker image at the pinned tag.
    image: 'ghcr.io/correlaid/schematron-worker',
  },
  formulaid: {
    repo: 'CorrelAid/formulaid',
    files: {
      'scripts/build_skill.sh': (v, sums) => [
        [/^(FORMTRANSFORM_VERSION=)"[^"]*"/m, () => `$1"${v}"`],
        [
          /^(FORMTRANSFORM_SKILL_SHA256=)"[^"]*"/m,
          () => `$1"${sumOf(sums, `cdl-survey-types-${v}.tar.gz`)}"`,
        ],
      ],
    },
    npm: [{ dir: '.', manager: 'bun' }],
  },
  'formtransform-app': {
    repo: 'CorrelAid/formtransform-app',
    files: {
      'tests/formtransform-fixtures.json': (v, sums) => [
        [/("version":\s*)"[^"]*"/, () => `$1"${v}"`],
        [
          /("url":\s*)"[^"]*"/,
          () => `$1"${RELEASES}/v${v}/formtransform-fixtures-${v}.tar.gz"`,
        ],
        [
          /("sha256":\s*)"[^"]*"/,
          () => `$1"${sumOf(sums, `formtransform-fixtures-${v}.tar.gz`)}"`,
        ],
      ],
    },
    npm: [{ dir: '.', manager: 'bun' }],
  },
};

/** Parse `sha256sum` output into { file: sum }. */
export function parseSums(text) {
  const sums = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(\S+)$/);
    if (m) sums[m[2]] = m[1];
  }
  return sums;
}

/**
 * The new contents of every pinned file of `consumer`, given `read(path)`.
 * Pure: the lockfiles are left to the package managers.
 */
export function rewritePins(consumer, version, sums, read) {
  const spec = CONSUMERS[consumer];
  if (!spec) throw new Error(`unknown consumer ${consumer}`);
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw new Error(`not a version: ${version} (expected e.g. 0.8.1, no "v")`);
  }
  const out = {};
  const apply = (path, rules) => {
    let text = out[path] ?? read(path);
    for (const [pattern, replacement] of rules) {
      pattern.lastIndex = 0;
      if (!pattern.test(text)) {
        throw new Error(`${consumer}: ${path} has no pin matching ${pattern}`);
      }
      pattern.lastIndex = 0;
      text = text.replace(pattern, replacement(version));
    }
    out[path] = text;
  };
  for (const [path, rules] of Object.entries(spec.files)) {
    apply(path, rules(version, sums));
  }
  for (const { dir, ownVersion } of spec.npm) {
    apply(join(dir, 'package.json'), [
      [TARBALL, (v) => tarballUrl(v)],
      ...(ownVersion
        ? [[/^(\s*"version":\s*)"[^"]*"/m, (v) => `$1"${v}"`]]
        : []),
    ]);
  }
  return out;
}

const LOCK_UPDATE = {
  npm: [
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
  ],
  bun: ['bun', ['install', '--lockfile-only', '--ignore-scripts']],
};

async function loadSums(version, file) {
  if (file) return parseSums(readFileSync(file, 'utf-8'));
  const res = await fetch(`${RELEASES}/v${version}/SHA256SUMS`);
  if (!res.ok)
    throw new Error(
      `v${version} has no SHA256SUMS (HTTP ${res.status}); is it released?`,
    );
  return parseSums(await res.text());
}

async function main(argv) {
  if (argv[0] === '--list') {
    for (const [name, spec] of Object.entries(CONSUMERS)) {
      console.log(`${name}\t${spec.repo}\t${spec.image ?? ''}`);
    }
    return;
  }
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const sumsAt = argv.indexOf('--sums');
  const sumsFile = sumsAt >= 0 ? argv[sumsAt + 1] : undefined;
  const [consumer, version, checkout] = argv.filter(
    (a, i) => !a.startsWith('--') && (sumsAt < 0 || i !== sumsAt + 1),
  );
  if (!consumer || !version || !checkout) {
    console.error(
      'usage: bump-consumers.mjs <consumer> <version> <checkout> [--sums FILE] [--no-lock]\n' +
        `consumers: ${Object.keys(CONSUMERS).join(', ')}`,
    );
    process.exit(2);
  }
  const sums = await loadSums(version, sumsFile);
  const files = rewritePins(consumer, version, sums, (p) =>
    readFileSync(join(checkout, p), 'utf-8'),
  );
  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(checkout, path), text);
    console.log(`  ${consumer}: ${path}`);
  }
  const spec = CONSUMERS[consumer];
  if (!flags.has('--no-lock')) {
    for (const { dir, manager } of spec.npm) {
      const [cmd, args] = LOCK_UPDATE[manager];
      execFileSync(cmd, args, { cwd: join(checkout, dir), stdio: 'inherit' });
      console.log(
        `  ${consumer}: ${join(dir, manager === 'npm' ? 'package-lock.json' : 'bun.lock')}`,
      );
    }
  }
  if (spec.verify && existsSync(join(checkout, spec.verify[1]))) {
    execFileSync(spec.verify[0], spec.verify.slice(1), {
      cwd: checkout,
      stdio: 'inherit',
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`bump-consumers: ${e.message}`);
    process.exit(1);
  });
}
