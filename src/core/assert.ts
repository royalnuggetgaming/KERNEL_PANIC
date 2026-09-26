/** Assertion helpers. */

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

/** Always-on check (cheap conditions only). */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}

/** DEV/test-only check; compiled away in production builds via __DEV__. */
export function devAssert(condition: unknown, message: string): void {
  if (__DEV__ && !condition) throw new InvariantError(message);
}

/** Exhaustiveness helper for switch statements over unions. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new InvariantError(`${message}: ${String(value)}`);
}

/** True for finite, non-negative safe integers (wallets, prices). */
export function isNonNegativeSafeInt(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}
