/** Minimal call recorder shared by the fake ports. */
export interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export class CallRecorder {
  readonly calls: RecordedCall[] = [];

  record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  count(method: string): number {
    let n = 0;
    for (const c of this.calls) if (c.method === method) n++;
    return n;
  }

  last(method: string): RecordedCall | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i]!;
      if (c.method === method) return c;
    }
    return undefined;
  }

  methods(): string[] {
    return this.calls.map((c) => c.method);
  }

  clear(): void {
    this.calls.length = 0;
  }
}
