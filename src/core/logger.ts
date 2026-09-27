/**
 * Logger implementations. core stays free of DOM/node globals: the console-backed logger receives its sink
 * (app passes `console`).
 */
import type { Logger } from '../contracts/ids';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Structural subset of the global console. */
export interface ConsoleLike {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createConsoleLogger(
  sink: ConsoleLike,
  minLevel: LogLevel = 'debug',
  prefix = '[kp]',
): Logger {
  const min = LEVEL_RANK[minLevel];
  const emit = (level: LogLevel, msg: string, data: unknown): void => {
    if (LEVEL_RANK[level] < min) return;
    if (data === undefined) sink[level](prefix, msg);
    else sink[level](prefix, msg, data);
  };
  return {
    debug: (m, d) => {
      emit('debug', m, d);
    },
    info: (m, d) => {
      emit('info', m, d);
    },
    warn: (m, d) => {
      emit('warn', m, d);
    },
    error: (m, d) => {
      emit('error', m, d);
    },
  };
}

const noop = (): void => undefined;

export const NullLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };

export interface LogEntry {
  readonly level: LogLevel;
  readonly msg: string;
  readonly data: unknown;
}

export interface MemoryLogger extends Logger {
  readonly entries: readonly LogEntry[];
  count(level: LogLevel): number;
  clear(): void;
}

export function createMemoryLogger(): MemoryLogger {
  const entries: LogEntry[] = [];
  const push = (level: LogLevel, msg: string, data: unknown): void => {
    entries.push({ level, msg, data });
  };
  return {
    entries,
    debug: (m, d) => {
      push('debug', m, d);
    },
    info: (m, d) => {
      push('info', m, d);
    },
    warn: (m, d) => {
      push('warn', m, d);
    },
    error: (m, d) => {
      push('error', m, d);
    },
    count: (level) => {
      let n = 0;
      for (const e of entries) if (e.level === level) n++;
      return n;
    },
    clear: () => {
      entries.length = 0;
    },
  };
}
