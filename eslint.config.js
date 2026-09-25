import { readdirSync } from 'node:fs';

import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const tsParser = tseslint.parser;

// Module boundaries (ARCHITECTURE.md): a format module never imports another
// format module or a pipeline, and a pipeline never imports a sibling pipeline.
// Shared code lives in src/conventions/, src/ddi/ (the Variable hub),
// src/diagnostics.ts or src/utils/.
const FORMATS = ['xlsform', 'lstsv', 'ddi'];
const PIPELINES = readdirSync(new URL('./src/pipelines/', import.meta.url), {
  withFileTypes: true,
})
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const boundaryRules = [
  ...FORMATS.map((format) => ({
    files: [`src/${format}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...FORMATS.filter((f) => f !== format).map((f) => `../${f}/*`),
                '../pipelines/*',
              ],
              message:
                'A format module must not import another format module or a pipeline (ARCHITECTURE.md).',
            },
          ],
        },
      ],
      // no-restricted-imports doesn't see dynamic import(); same rule for it.
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression[source.value=/^\\.\\.\\/(${[...FORMATS.filter((f) => f !== format), 'pipelines'].join('|')})\\//]`,
          message:
            'A format module must not import another format module or a pipeline (ARCHITECTURE.md).',
        },
      ],
    },
  })),
  ...PIPELINES.map((pipeline) => ({
    files: [`src/pipelines/${pipeline}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: PIPELINES.filter((p) => p !== pipeline).map(
                (p) => `../${p}/*`,
              ),
              message:
                'A pipeline must not import a sibling pipeline; move shared code to src/conventions/, src/ddi/ or src/utils/ (ARCHITECTURE.md).',
            },
          ],
        },
      ],
    },
  })),
];

export default defineConfig([
  ...boundaryRules,

  // Global: fail on eslint-disable directives that no longer suppress anything,
  // so dead disables can't accumulate.
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Base configs
  js.configs.recommended,
  tseslint.configs.recommended,

  // Type-aware linting for TS modules in the tsconfig project. Tests, generated
  // code, and *.d.ts sit outside the tsconfig (or are excluded), so the project
  // service can't type them — they fall back to non-type-checked linting.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ['src/**/*.ts'],
    ignores: [
      'src/test/**',
      'src/**/*.test.ts',
      'src/generated/**',
      'src/types/**/*.d.ts',
    ],
  })),
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/test/**',
      'src/**/*.test.ts',
      'src/generated/**',
      'src/types/**/*.d.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Complexity gates (warn-level ratchet — caps existing hotspots, blocks
  // regression growth via --max-warnings).
  {
    files: ['**/*.{ts,js,mjs}'],
    rules: {
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
    },
  },

  // Ratchet rules: pervasive in this XLSForm/DDI parser codebase. Kept as
  // warnings (capped via --max-warnings) so existing hits don't block, but any
  // new one counts against the cap. Tighten toward 'error' as hotspots clear.
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },

  // Ignore build output, generated code, vendored checkouts, tests and the
  // vitest config. These sit outside the tsconfig project (projectService can't
  // type them) and are not shipped — Prettier still formats them via the
  // format script.
  {
    ignores: [
      'dist/**',
      '**/*.d.ts',
      'src/generated/**',
      '.github/',
      '_xlsform2lstsv/**',
      'docs/**',
      'src/test/**',
      'tests/**',
      'vitest.config.ts',
      '**/*.test.ts',
    ],
  },
]);
