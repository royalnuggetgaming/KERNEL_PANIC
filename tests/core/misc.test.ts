import { describe, expect, it } from 'vitest';
import {
  assertNever,
  devAssert,
  invariant,
  InvariantError,
  isNonNegativeSafeInt,
} from '../../src/core/assert';
import { createConsoleLogger, createMemoryLogger, NullLogger } from '../../src/core/logger';
import { err, isOk, ok } from '../../src/core/result';
import { FakeWindow } from '../helpers/fakeWindow';

describe('assert / result / logger', () => {
  it('invariant and devAssert throw InvariantError (__DEV__ is true in tests)', () => {
    expect(__DEV__).toBe(true);
    expect(() => {
      invariant(false, 'boom');
    }).toThrow(InvariantError);
    expect(() => {
      devAssert(false, 'dev');
    }).toThrow('dev');
    expect(() => assertNever('x' as never)).toThrow(/Unexpected value: x/);
    invariant(true, 'fine');
    expect(isNonNegativeSafeInt(5)).toBe(true);
    expect(isNonNegativeSafeInt(-1)).toBe(false);
    expect(isNonNegativeSafeInt(1.5)).toBe(false);
    expect(isNonNegativeSafeInt(Number.NaN)).toBe(false);
  });

  it('ok/err', () => {
    const a = ok(3);
    const b = err('nope');
    expect(isOk(a)).toBe(true);
    expect(isOk(b)).toBe(false);
    expect(a.ok && a.value).toBe(3);
    expect(!b.ok && b.error).toBe('nope');
  });

  it('loggers route and filter by level', () => {
    const m = createMemoryLogger();
    m.info('a');
    m.warn('b', { x: 1 });
    expect(m.count('warn')).toBe(1);
    expect(m.entries[1]).toEqual({ level: 'warn', msg: 'b', data: { x: 1 } });
    m.clear();
    expect(m.entries).toHaveLength(0);
    const lines: unknown[][] = [];
    const sink = {
      debug: (...a: unknown[]) => lines.push(['debug', ...a]),
      info: (...a: unknown[]) => lines.push(['info', ...a]),
      warn: (...a: unknown[]) => lines.push(['warn', ...a]),
      error: (...a: unknown[]) => lines.push(['error', ...a]),
    };
    const c = createConsoleLogger(sink, 'warn');
    c.info('hidden');
    c.warn('shown');
    c.error('err', 7);
    expect(lines).toEqual([
      ['warn', '[kp]', 'shown'],
      ['error', '[kp]', 'err', 7],
    ]);
    NullLogger.error('ignored');
  });

  it('FakeWindow emits to listeners', () => {
    const w = new FakeWindow();
    let n = 0;
    const fn = (): void => {
      n++;
    };
    w.addEventListener('blur', fn);
    w.document.addEventListener('visibilitychange', fn);
    w.emit('blur');
    w.document.setHidden(true);
    expect(n).toBe(2);
    expect(w.document.hidden).toBe(true);
    w.removeEventListener('blur', fn);
    expect(w.listenerCount('blur')).toBe(0);
    expect(w.emit('pagehide').defaultPrevented).toBe(false);
  });
});
