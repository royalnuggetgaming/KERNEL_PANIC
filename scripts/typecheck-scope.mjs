#!/usr/bin/env node
/**
 * Scoped typecheck for parallel agents: runs tsc over tsconfig.json AND tsconfig.pure.json and reports only
 * diagnostics whose file path starts with one of the given prefixes, so an agent can verify its own files
 * while siblings are mid-edit.
 *
 * Usage: node scripts/typecheck-scope.mjs src/input tests/input
 * Exit code: 0 when no in-scope diagnostics, 1 otherwise, 2 on usage errors.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefixes = process.argv
  .slice(2)
  .map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
if (prefixes.length === 0) {
  process.stderr.write('usage: node scripts/typecheck-scope.mjs <path-prefix> [...]\n');
  process.exit(2);
}

const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
/** @type {string[]} */
const kept = [];
for (const project of ['tsconfig.json', 'tsconfig.pure.json']) {
  const res = spawnSync(process.execPath, [TSC, '-p', project, '--noEmit', '--pretty', 'false'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    process.stderr.write(`typecheck-scope: failed to run tsc: ${res.error.message}\n`);
    process.exit(2);
  }
  const lines = `${res.stdout}${res.stderr}`.split('\n');
  let keepContinuation = false;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const m = /^(.+?)\(\d+,\d+\): (error|warning)/.exec(line);
    if (m) {
      const file = (m[1] ?? '').replace(/\\/g, '/');
      keepContinuation = prefixes.some((p) => file === p || file.startsWith(`${p}/`) || file.startsWith(p));
      if (keepContinuation) kept.push(`[${project}] ${line}`);
    } else if (/^\s/.test(line) && keepContinuation) {
      kept.push(line);
    } else if (line.startsWith('error TS')) {
      // Global (file-less) diagnostics such as config errors always count.
      kept.push(`[${project}] ${line}`);
      keepContinuation = false;
    } else {
      keepContinuation = false;
    }
  }
}

if (kept.length > 0) {
  process.stdout.write(`${kept.join('\n')}\n`);
  process.stdout.write(
    `typecheck-scope: ${String(kept.filter((l) => l.startsWith('[')).length)} diagnostic(s) in scope\n`,
  );
  process.exit(1);
}
process.stdout.write(`typecheck-scope: OK (${prefixes.join(', ')})\n`);
