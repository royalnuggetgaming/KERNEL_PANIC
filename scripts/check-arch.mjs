#!/usr/bin/env node
/**
 * Architecture gate (dependency-free). Fails (exit 1) on:
 * - layer-matrix violations between src/ top-level directories (docs/ARCHITECTURE.md),
 * - 'three' imported outside assets/, render/, app/, debug/,
 * - cycles between src/ top-level directories,
 * - files over 400 lines (src/, tests/, scripts/),
 * - banned text: TODO, FIXME, placeholder, "not implemented", @ts-ignore, @ts-expect-error without a reason,
 *   `as any`, `export default` in src, console.* outside core/logger.ts, enums, namespaces, index.ts barrels,
 *   and `new *Material(` / `new *Geometry(` outside assets/, render/InstanceBatch.ts, render/GpuRingBuffer.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const MAX_LINES = 400;
const CODE_EXT = new Set(['.ts', '.mts', '.js', '.mjs', '.css']);

/** Allowed import targets per src/ top-level directory (itself is always allowed). */
const L0_L2 = ['contracts', 'core', 'config', 'themes'];
/** @type {Record<string, readonly string[]>} */
const LAYERS = {
  contracts: [],
  core: ['contracts'],
  config: ['contracts', 'core'],
  themes: ['contracts', 'core', 'config'],
  engine: L0_L2,
  input: L0_L2,
  entities: L0_L2,
  upgrades: L0_L2,
  save: L0_L2,
  sim: [...L0_L2, 'entities', 'upgrades'],
  states: [...L0_L2, 'upgrades'],
  shaders: ['contracts'],
  assets: [...L0_L2, 'shaders'],
  render: [...L0_L2, 'shaders'],
  audio: L0_L2,
  ui: ['contracts', 'core'],
  debug: ['contracts', 'core'],
  app: [
    ...L0_L2,
    'engine',
    'input',
    'entities',
    'upgrades',
    'save',
    'sim',
    'states',
    'shaders',
    'assets',
    'render',
    'audio',
    'ui',
    'debug',
  ],
  '<root>': ['app', 'ui'],
};

/** Single-file exceptions: importer dir -> allowed files (relative to src). */
/** @type {Record<string, readonly string[]>} */
const FILE_EXCEPTIONS = {
  assets: ['render/InstanceBatch.ts', 'render/GpuRingBuffer.ts', 'render/assetTypes.ts'],
  debug: ['engine/PerfMonitor.ts'],
};

const THREE_ALLOWED = new Set(['assets', 'render', 'app', 'debug']);
const NEW_THREE_OBJECT_ALLOWED = ['assets/', 'render/InstanceBatch.ts', 'render/GpuRingBuffer.ts'];

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (CODE_EXT.has(extname(name))) out.push(p);
  }
  return out;
}

/** @param {string} p */
const rel = (p) => relative(ROOT, p).split(sep).join('/');

/** Top-level src directory of a file ('<root>' for files directly in src). @param {string} file */
function layerOf(file) {
  const r = relative(SRC, file).split(sep);
  return r.length === 1 ? '<root>' : (r[0] ?? '<root>');
}

/** Removes comments and string/template contents (keeps quotes) so code bans do not fire on prose. @param {string} s */
function stripCommentsAndStrings(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '/' && n === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) {
        if (s[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += q;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') i++;
        else if (s[i] === '\n') out += '\n';
        i++;
      }
      out += q;
      i++;
    } else {
      out += c ?? '';
      i++;
    }
  }
  return out;
}

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s*['"]([^'"]+)['"]/g;

/** @param {string} text @returns {string[]} */
function importsOf(text) {
  /** @type {string[]} */
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec !== undefined) out.push(spec);
  }
  return out;
}

/** @param {string} fromFile @param {string} spec */
function resolveSpec(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.css`,
    join(base, 'index.ts'),
  ]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      /* try next */
    }
  }
  return base;
}

/** @type {string[]} */
const errors = [];
/** @param {string} file @param {number} line @param {string} msg */
const fail = (file, line, msg) => errors.push(`${rel(file)}:${String(line)}: ${msg}`);

/** @param {string} text @param {number} index */
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Line of a regex match, skipping a leading boundary character (e.g. the newline before `console`). @param {string} text @param {RegExpExecArray} m */
const matchLine = (text, m) =>
  lineAt(
    text,
    m.index + (m[0].length - m[0].trimStart().length) + (/^[^\w@]/.test(m[0].trimStart()) ? 1 : 0),
  );

const TEXT_BANS = [
  { re: /\bTODO\b/, msg: 'TODO is banned' },
  { re: /\bFIXME\b/, msg: 'FIXME is banned' },
  { re: /placeholder/i, msg: '"placeholder" is banned' },
  { re: /not implemented/i, msg: '"not implemented" is banned' },
  { re: /@ts-ignore/, msg: '@ts-ignore is banned' },
  { re: /@ts-nocheck/, msg: '@ts-nocheck is banned' },
  { re: /@ts-expect-error(?!\s*(?:--|:)?\s*\S)/, msg: '@ts-expect-error needs a reason' },
];

const CODE_BANS = [
  { re: /\bas\s+any\b/, msg: '`as any` is banned' },
  { re: /(?:^|[^.\w])enum\s+[A-Za-z_$]/, msg: 'enums are banned (erasableSyntaxOnly)' },
  { re: /(?:^|[^.\w])namespace\s+[A-Za-z_$]/, msg: 'namespaces are banned' },
];

const srcFiles = walk(SRC);
const allFiles = [...srcFiles, ...walk(join(ROOT, 'tests')), ...walk(join(ROOT, 'scripts'))];
const THIS_FILE = fileURLToPath(import.meta.url);

/** @type {Map<string, Set<string>>} */
const dirGraph = new Map();

for (const file of allFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  if (lines > MAX_LINES) fail(file, lines, `file has ${String(lines)} lines (max ${String(MAX_LINES)})`);
  if (file === THIS_FILE || extname(file) === '.css') continue;
  for (const ban of TEXT_BANS) {
    const m = ban.re.exec(text);
    if (m) fail(file, lineAt(text, m.index), ban.msg);
  }
  const code = stripCommentsAndStrings(text);
  for (const ban of CODE_BANS) {
    const m = ban.re.exec(code);
    if (m) fail(file, matchLine(code, m), ban.msg);
  }
}

for (const file of srcFiles) {
  if (extname(file) === '.css') continue;
  const r = relative(SRC, file).split(sep).join('/');
  const layer = layerOf(file);
  const text = readFileSync(file, 'utf8');
  const code = stripCommentsAndStrings(text);
  if (/(?:^|\/)index\.[mc]?[jt]s$/.test(r)) fail(file, 1, 'barrel index files are banned');
  const def = /\bexport\s+default\b/.exec(code);
  if (def) fail(file, lineAt(code, def.index), '`export default` is banned in src');
  const con = /(?:^|[^.\w$])console\s*\./.exec(code);
  if (con && r !== 'core/logger.ts')
    fail(file, matchLine(code, con), 'console.* is only allowed in core/logger.ts');
  const newObj = /\bnew\s+(?:THREE\.)?[A-Za-z0-9_]*(?:Material|Geometry)\s*[(<]/.exec(code);
  if (newObj && !NEW_THREE_OBJECT_ALLOWED.some((p) => r.startsWith(p))) {
    fail(
      file,
      lineAt(code, newObj.index),
      'new *Material/*Geometry only in assets/, render/InstanceBatch.ts, render/GpuRingBuffer.ts',
    );
  }
  const allowed = LAYERS[layer];
  if (allowed === undefined) {
    fail(file, 1, `unknown src directory "${layer}" (add it to the layer matrix)`);
    continue;
  }
  for (const spec of importsOf(text)) {
    if (spec === 'three' || spec.startsWith('three/')) {
      if (!THREE_ALLOWED.has(layer)) fail(file, 1, `'three' is not allowed in ${layer}/`);
      continue;
    }
    if (!spec.startsWith('.')) continue;
    const target = resolveSpec(file, spec);
    if (!target.startsWith(SRC + sep)) {
      fail(file, 1, `import escapes src/: ${spec}`);
      continue;
    }
    const tLayer = layerOf(target);
    const tRel = relative(SRC, target).split(sep).join('/');
    if (tLayer === layer) continue;
    if (!dirGraph.has(layer)) dirGraph.set(layer, new Set());
    dirGraph.get(layer)?.add(tLayer);
    const fileOk = (FILE_EXCEPTIONS[layer] ?? []).includes(tRel);
    if (!allowed.includes(tLayer) && !fileOk)
      fail(file, 1, `layer violation: ${layer}/ must not import ${tRel}`);
  }
}

// Cycle detection between top-level directories.
/** @type {Map<string, number>} */
const color = new Map();
/** @param {string} n @param {string[]} path */
function dfs(n, path) {
  color.set(n, 1);
  for (const m of dirGraph.get(n) ?? []) {
    const c = color.get(m) ?? 0;
    if (c === 1) errors.push(`cycle between directories: ${[...path, n, m].join(' -> ')}`);
    else if (c === 0) dfs(m, [...path, n]);
  }
  color.set(n, 2);
}
for (const n of dirGraph.keys()) if ((color.get(n) ?? 0) === 0) dfs(n, []);

if (errors.length > 0) {
  for (const e of errors) process.stderr.write(`check-arch: ${e}\n`);
  process.stderr.write(`check-arch: ${String(errors.length)} violation(s)\n`);
  process.exit(1);
}
process.stdout.write(
  `check-arch: OK (${String(allFiles.length)} files, ${String(srcFiles.length)} in src)\n`,
);
