/**
 * Optional real GLSL compile check: when `glslangValidator` is on PATH, every material (as three.js would
 * assemble it for a GLSL3 ShaderMaterial: version, precision, defines, built-in uniforms/attributes) is
 * compiled (vertex and fragment) as GLSL ES 3.00; stage interface matching is covered by shaders.test.ts. Skipped when the tool is absent (no GPU in CI).
 */
import { DoubleSide, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createAssetLibrary } from '../../src/assets/AssetLibrary';
import { POST_MATERIAL_KEYS, SCENE_MATERIAL_KEYS } from '../../src/assets/materials';
import { QUALITY_PRESETS } from '../../src/config/quality';
import { NullLogger } from '../../src/core/logger';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';

/** Structural subset of node:child_process (the app tsconfig has no node types). */
interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
interface ChildProcessLike {
  spawnSync(
    cmd: string,
    args: readonly string[],
    opts: { readonly encoding: 'utf8'; readonly input?: string },
  ): SpawnResult;
}

function isChildProcess(m: unknown): m is ChildProcessLike {
  return typeof m === 'object' && m !== null && typeof Reflect.get(m, 'spawnSync') === 'function';
}

// A variable specifier keeps TS from resolving node types the app tsconfig does not load.
const CHILD_PROCESS = 'node:child_process';
const childProcess: unknown = await import(/* @vite-ignore */ CHILD_PROCESS);
const cp = isChildProcess(childProcess) ? childProcess : null;
const HAS_GLSLANG =
  cp !== null && cp.spawnSync('glslangValidator', ['--version'], { encoding: 'utf8' }).status === 0;

/** Compiles one stage from stdin; returns the error log ('' when it compiles). */
function compile(stage: 'vert' | 'frag', source: string): string {
  if (cp === null) return 'node:child_process unavailable';
  const r = cp.spawnSync('glslangValidator', ['--stdin', '-S', stage], { encoding: 'utf8', input: source });
  return r.status === 0 ? '' : r.stdout + r.stderr;
}

function header(m: ShaderMaterial): string {
  const defs = Object.entries(m.defines)
    .map(([k, v]) => `#define ${k} ${String(v)}`)
    .join('\n');
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    defs,
    m.vertexColors ? '#define USE_COLOR' : '',
    m.side === DoubleSide ? '#define DOUBLE_SIDED' : '',
  ].join('\n');
}

function vertexSource(m: ShaderMaterial): string {
  return [
    header(m),
    '#define attribute in',
    '#define varying out',
    '#define texture2D texture',
    'uniform mat4 modelMatrix;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat4 projectionMatrix;',
    'uniform mat4 viewMatrix;',
    'uniform mat3 normalMatrix;',
    'uniform vec3 cameraPosition;',
    'uniform bool isOrthographic;',
    'in vec3 position;',
    'in vec3 normal;',
    'in vec2 uv;',
    '#if defined(USE_COLOR)',
    'in vec3 color;',
    '#endif',
    m.vertexShader,
  ].join('\n');
}

function fragmentSource(m: ShaderMaterial): string {
  return [
    header(m),
    '#define varying in',
    '#define texture2D texture',
    'uniform mat4 viewMatrix;',
    'uniform vec3 cameraPosition;',
    'uniform bool isOrthographic;',
    m.fragmentShader,
  ].join('\n');
}

describe.skipIf(!HAS_GLSLANG)('glslangValidator (GLSL ES 3.00 compile)', () => {
  it('compiles both stages of every material', async () => {
    const lib = createAssetLibrary({
      theme: KERNEL_PANIC,
      quality: QUALITY_PRESETS.high,
      log: NullLogger,
      seed: 7,
    });
    await lib.build(() => undefined);
    const failures: string[] = [];
    for (const key of [...SCENE_MATERIAL_KEYS, ...POST_MATERIAL_KEYS]) {
      const m = lib.getMaterial(key);
      const v = compile('vert', vertexSource(m));
      const f = compile('frag', fragmentSource(m));
      if (v !== '') failures.push(`${key} (vertex):\n${v}`);
      if (f !== '') failures.push(`${key} (fragment):\n${f}`);
    }
    lib.dispose();
    expect(failures.join('\n')).toBe('');
  }, 120_000);
});
