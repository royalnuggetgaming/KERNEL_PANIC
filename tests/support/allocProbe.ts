/**
 * PERF critic helper: measures bytes allocated by a synchronous workload with V8's sampling heap profiler
 * (node:inspector, HeapProfiler.startSampling with objects collected by minor/major GC included), so the
 * number does not depend on whether a scavenge happened inside the window. Also returns the top allocating
 * functions (self bytes per iteration) for the failure message. Returns null outside node.
 */

interface CallFrame {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
}

interface SamplingNode {
  readonly callFrame: CallFrame;
  readonly selfSize: number;
  readonly children: readonly SamplingNode[];
}

interface InspectorSession {
  connect(): void;
  disconnect(): void;
  post(method: string, params?: object): Promise<unknown>;
}

export interface AllocReport {
  /** Sampled bytes allocated per iteration of the workload. */
  readonly bytesPerIter: number;
  /** "<bytes/iter> B  fn (file:line)" for the heaviest allocating functions. */
  readonly top: readonly string[];
}

const INSPECTOR = 'node:inspector/promises';

async function openSession(): Promise<InspectorSession | null> {
  try {
    const mod = await import(/* @vite-ignore */ INSPECTOR);
    const session = new mod.Session() as InspectorSession;
    session.connect();
    return session;
  } catch {
    return null;
  }
}

function shortUrl(url: string): string {
  const i = url.lastIndexOf('/src/');
  if (i >= 0) return url.slice(i + 1);
  const j = url.lastIndexOf('/');
  return j >= 0 ? url.slice(j + 1) : url;
}

/**
 * Runs `warmup` iterations unmeasured (JIT), then `iters` iterations under the sampling heap profiler.
 * `step(i)` must perform one iteration of the workload.
 */
export async function measureAllocation(
  step: (i: number) => void,
  iters: number,
  warmup: number,
  samplingInterval = 64,
): Promise<AllocReport | null> {
  for (let i = 0; i < warmup; i++) step(i);
  const session = await openSession();
  if (session === null) return null;
  try {
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', {
      samplingInterval,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    for (let i = 0; i < iters; i++) step(warmup + i);
    const res = (await session.post('HeapProfiler.stopSampling')) as { profile: { head: SamplingNode } };
    const self = new Map<string, number>();
    let total = 0;
    const walk = (n: SamplingNode): void => {
      if (n.selfSize > 0) {
        const cf = n.callFrame;
        const key = `${cf.functionName || '(anonymous)'} (${shortUrl(cf.url)}:${cf.lineNumber + 1})`;
        self.set(key, (self.get(key) ?? 0) + n.selfSize);
        total += n.selfSize;
      }
      for (const c of n.children) walk(c);
    };
    walk(res.profile.head);
    const top = [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${Math.round(v / iters)} B  ${k}`);
    return { bytesPerIter: total / iters, top };
  } finally {
    await session.post('HeapProfiler.disable').catch(() => undefined);
    session.disconnect();
  }
}
