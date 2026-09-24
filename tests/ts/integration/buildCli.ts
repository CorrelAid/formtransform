/**
 * Vitest globalSetup for the integration project: build `dist/` once before
 * any file runs, so CLI tests that spawn `dist/cli.js` don't race each other
 * rebuilding it.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup(): void {
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: resolve(__dirname, '../../..'),
    encoding: 'utf-8',
  });
  if (build.status !== 0) throw new Error(`build failed:\n${build.stderr}`);
}
