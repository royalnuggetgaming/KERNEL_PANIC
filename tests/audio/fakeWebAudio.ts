/**
 * Minimal structural Web Audio fake for node tests: records node creation, connections, param automation
 * and start/stop calls, and validates the same preconditions the browser enforces (exponential ramps to
 * positive values, start once, stop after start).
 */

export interface ParamEvent {
  readonly type: 'set' | 'linear' | 'exp' | 'target' | 'cancel';
  readonly value: number;
  readonly time: number;
}

export class FakeParam {
  value: number;
  readonly owner: FakeNode;
  readonly events: ParamEvent[] = [];

  constructor(owner: FakeNode, value: number) {
    this.owner = owner;
    this.value = value;
  }

  private check(v: number, t: number): void {
    if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) throw new RangeError(`bad automation ${v}@${t}`);
  }

  setValueAtTime(v: number, t: number): this {
    this.check(v, t);
    this.events.push({ type: 'set', value: v, time: t });
    this.value = v;
    return this;
  }

  linearRampToValueAtTime(v: number, t: number): this {
    this.check(v, t);
    this.events.push({ type: 'linear', value: v, time: t });
    this.value = v;
    return this;
  }

  exponentialRampToValueAtTime(v: number, t: number): this {
    this.check(v, t);
    if (v <= 0) throw new RangeError('exponential ramp target must be positive');
    this.events.push({ type: 'exp', value: v, time: t });
    this.value = v;
    return this;
  }

  setTargetAtTime(v: number, t: number, tc: number): this {
    this.check(v, t);
    if (!(tc > 0)) throw new RangeError('time constant must be positive');
    this.events.push({ type: 'target', value: v, time: t });
    this.value = v;
    return this;
  }

  cancelScheduledValues(t: number): this {
    this.check(0, t);
    this.events.push({ type: 'cancel', value: 0, time: t });
    return this;
  }
}

export class FakeNode {
  readonly ctx: FakeContext;
  readonly kind: string;
  readonly outputs: (FakeNode | FakeParam)[] = [];
  readonly params: Record<string, FakeParam> = {};
  type = '';
  curve: Float32Array | null = null;
  oversample = 'none';
  buffer: FakeBuffer | null = null;
  normalize = true;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  constructor(ctx: FakeContext, kind: string, params: Record<string, number> = {}) {
    this.ctx = ctx;
    this.kind = kind;
    for (const k of Object.keys(params)) this.params[k] = new FakeParam(this, params[k]!);
    ctx.nodes.push(this);
  }

  private p(name: string): FakeParam {
    const p = this.params[name];
    if (!p) throw new Error(`${this.kind} has no param ${name}`);
    return p;
  }
  get gain(): FakeParam {
    return this.p('gain');
  }
  get frequency(): FakeParam {
    return this.p('frequency');
  }
  get detune(): FakeParam {
    return this.p('detune');
  }
  get Q(): FakeParam {
    return this.p('Q');
  }
  get pan(): FakeParam {
    return this.p('pan');
  }
  get playbackRate(): FakeParam {
    return this.p('playbackRate');
  }
  get threshold(): FakeParam {
    return this.p('threshold');
  }
  get ratio(): FakeParam {
    return this.p('ratio');
  }
  get knee(): FakeParam {
    return this.p('knee');
  }
  get attack(): FakeParam {
    return this.p('attack');
  }
  get release(): FakeParam {
    return this.p('release');
  }

  connect<T extends FakeNode | FakeParam>(dest: T): T {
    if (dest instanceof FakeNode && dest.ctx !== this.ctx) throw new Error('cross-context connect');
    this.outputs.push(dest);
    return dest;
  }

  disconnect(): void {
    this.outputs.length = 0;
  }

  start(t = 0): void {
    if (this.startedAt !== null) throw new Error(`${this.kind} started twice`);
    if (!(t >= 0)) throw new RangeError('bad start time');
    this.startedAt = t;
  }

  stop(t = 0): void {
    if (this.startedAt === null) throw new Error(`${this.kind} stopped before start`);
    if (!(t >= 0)) throw new RangeError('bad stop time');
    this.stoppedAt = t;
  }
}

export class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[] = [];

  constructor(channels: number, length: number, sampleRate: number) {
    if (length < 1) throw new RangeError('buffer length must be >= 1');
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    for (let c = 0; c < channels; c++) this.data.push(new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(c: number): Float32Array {
    const d = this.data[c];
    if (!d) throw new RangeError('bad channel');
    return d;
  }
}

export class FakeContext {
  currentTime = 0;
  readonly sampleRate: number;
  state = 'suspended' as string;
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.destination = new FakeNode(this, 'destination');
  }

  createGain(): FakeNode {
    return new FakeNode(this, 'gain', { gain: 1 });
  }
  createOscillator(): FakeNode {
    const n = new FakeNode(this, 'oscillator', { frequency: 440, detune: 0 });
    n.type = 'sine';
    return n;
  }
  createBufferSource(): FakeNode {
    return new FakeNode(this, 'bufferSource', { playbackRate: 1, detune: 0 });
  }
  createBiquadFilter(): FakeNode {
    const n = new FakeNode(this, 'biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 });
    n.type = 'lowpass';
    return n;
  }
  createWaveShaper(): FakeNode {
    return new FakeNode(this, 'waveShaper');
  }
  createStereoPanner(): FakeNode {
    return new FakeNode(this, 'panner', { pan: 0 });
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode(this, 'compressor', {
      threshold: -24,
      ratio: 12,
      knee: 30,
      attack: 0.003,
      release: 0.25,
    });
  }
  createConvolver(): FakeNode {
    return new FakeNode(this, 'convolver');
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state !== 'closed') this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
    return Promise.resolve();
  }

  count(kind: string): number {
    let n = 0;
    for (const node of this.nodes) if (node.kind === kind) n++;
    return n;
  }

  /** Nodes whose output never reaches the destination (following connections into params' owners). */
  unreachable(): FakeNode[] {
    const reach = new Set<FakeNode>([this.destination]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of this.nodes) {
        if (reach.has(n)) continue;
        for (const o of n.outputs) {
          const target = o instanceof FakeParam ? o.owner : o;
          if (reach.has(target)) {
            reach.add(n);
            changed = true;
            break;
          }
        }
      }
    }
    return this.nodes.filter((n) => !reach.has(n));
  }

  /** Scheduled sources that were started but never given an explicit stop time. */
  unstopped(): FakeNode[] {
    return this.nodes.filter((n) => n.startedAt !== null && n.stoppedAt === null);
  }
}

export class FakeOfflineContext extends FakeContext {
  readonly length: number;
  readonly channels: number;
  fail = false;

  constructor(channels: number, length: number, sampleRate: number) {
    super(sampleRate);
    this.channels = channels;
    this.length = length;
    this.state = 'suspended';
  }

  startRendering(): Promise<FakeBuffer> {
    if (this.fail) return Promise.reject(new Error('render failed'));
    const buf = new FakeBuffer(this.channels, this.length, this.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.05) * 1.5;
    return Promise.resolve(buf);
  }
}
