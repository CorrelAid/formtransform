/**
 * scripts/bump-consumers.mjs (#172): each consumer's pins, as its repo holds
 * them, move to the new version, and a missing pin fails instead of being
 * skipped.
 */
import { describe, test, expect } from 'vitest';

// @ts-expect-error -- a plain .mjs script, no type declarations
import {
  CONSUMERS,
  parseSums,
  rewritePins,
} from '../../../scripts/bump-consumers.mjs';

const OLD =
  'https://github.com/CorrelAid/formtransform/releases/download/v0.7.1';
const NEW =
  'https://github.com/CorrelAid/formtransform/releases/download/v0.8.1';
const SUMS = parseSums(
  [
    `${'a'.repeat(64)}  correlaid-formtransform-0.8.1.tgz`,
    `${'b'.repeat(64)}  cdl-survey-types-0.8.1.tar.gz`,
    `${'c'.repeat(64)}  formtransform-fixtures-0.8.1.tar.gz`,
    `${'d'.repeat(64)}  SHA256SUMS-is-not-listed-but-ignored`,
  ].join('\n'),
);

const npmPkg = (url: string) =>
  `{\n\t"dependencies": {\n\t\t"@correlaid/formtransform": "${url}/correlaid-formtransform-0.7.1.tgz",\n\t\t"marked": "^17.0.5"\n\t}\n}\n`;

// Excerpts of each consumer's files as they pin 0.7.1 today.
const REPOS: Record<string, Record<string, string>> = {
  qwacback: {
    '.registry-version': 'v0.7.1\n',
    'docker-compose.yml':
      'services:\n  schematron-worker:\n    image: ghcr.io/correlaid/schematron-worker:v0.7.1  # must equal .registry-version\n',
    'ddi-emitter/package.json': npmPkg(OLD).replace(
      '{\n',
      '{\n\t"version": "0.7.1",\n',
    ),
  },
  formulaid: {
    'package.json': npmPkg(OLD),
    'scripts/build_skill.sh':
      'FORMTRANSFORM_VERSION="0.7.1"\nFORMTRANSFORM_SKILL_SHA256="98de"\nFORMTRANSFORM_SKILL_URL="…/v$FORMTRANSFORM_VERSION/…"\n',
  },
  'formtransform-app': {
    'package.json': npmPkg(OLD),
    'tests/formtransform-fixtures.json': `{\n\t"version": "0.7.1",\n\t"url": "${OLD}/formtransform-fixtures-0.7.1.tar.gz",\n\t"sha256": "b241"\n}\n`,
  },
};

const bump = (consumer: string, files = REPOS[consumer], version = '0.8.1') =>
  rewritePins(consumer, version, SUMS, (p: string) => {
    if (!(p in files)) throw new Error(`ENOENT ${p}`);
    return files[p];
  }) as Record<string, string>;

describe('bump-consumers', () => {
  test('every consumer has a fixture here', () => {
    expect(Object.keys(CONSUMERS).sort()).toEqual(Object.keys(REPOS).sort());
  });

  test('qwacback: .registry-version, worker image, ddi-emitter tarball and version', () => {
    const out = bump('qwacback');
    expect(out['.registry-version']).toBe('v0.8.1\n');
    expect(out['docker-compose.yml']).toContain(
      'schematron-worker:v0.8.1  # must equal .registry-version',
    );
    // Its own version follows formtransform's (qwacback#71).
    expect(out['ddi-emitter/package.json']).toBe(
      npmPkg(NEW)
        .replace('0.7.1.tgz', '0.8.1.tgz')
        .replace('{\n', '{\n\t"version": "0.8.1",\n'),
    );
  });

  test('formulaid: tarball, skill version and its checksum', () => {
    const out = bump('formulaid');
    expect(out['package.json']).toContain(
      `${NEW}/correlaid-formtransform-0.8.1.tgz`,
    );
    expect(out['scripts/build_skill.sh']).toBe(
      `FORMTRANSFORM_VERSION="0.8.1"\nFORMTRANSFORM_SKILL_SHA256="${'b'.repeat(64)}"\nFORMTRANSFORM_SKILL_URL="…/v$FORMTRANSFORM_VERSION/…"\n`,
    );
  });

  test('formtransform-app: tarball and the fixtures pin, formatting kept', () => {
    const out = bump('formtransform-app');
    expect(out['tests/formtransform-fixtures.json']).toBe(
      `{\n\t"version": "0.8.1",\n\t"url": "${NEW}/formtransform-fixtures-0.8.1.tar.gz",\n\t"sha256": "${'c'.repeat(64)}"\n}\n`,
    );
  });

  test('a moved pin fails, naming it', () => {
    const files = {
      ...REPOS.formulaid,
      'scripts/build_skill.sh': 'VERSION=0.7.1\n',
    };
    expect(() => bump('formulaid', files)).toThrow(
      /build_skill\.sh has no pin/,
    );
  });

  test('an asset missing from SHA256SUMS fails', () => {
    expect(() =>
      rewritePins('formulaid', '0.8.1', {}, (p: string) => REPOS.formulaid[p]),
    ).toThrow(/SHA256SUMS has no cdl-survey-types-0\.8\.1\.tar\.gz/);
  });

  test('a tag instead of a version fails', () => {
    expect(() => bump('qwacback', REPOS.qwacback, 'v0.8.1')).toThrow(
      /not a version/,
    );
  });
});
