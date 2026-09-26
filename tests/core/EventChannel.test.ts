import { describe, expect, it } from 'vitest';
import { EventChannel } from '../../src/core/EventChannel';

describe('EventChannel', () => {
  it('reuses preallocated structs and counts overflow', () => {
    const ch = new EventChannel(2, () => ({ x: 0 }));
    ch.push().x = 1;
    ch.push().x = 2;
    const scratch = ch.push();
    scratch.x = 3;
    expect(ch.count).toBe(2);
    expect(ch.dropped).toBe(1);
    expect(ch.get(0).x).toBe(1);
    expect(ch.get(1).x).toBe(2);
    expect(() => ch.get(2)).toThrow(RangeError);
    const first = ch.get(0);
    ch.clear();
    expect(ch.count).toBe(0);
    expect(ch.push()).toBe(first);
    expect(ch.dropped).toBe(1);
    ch.resetDropped();
    expect(ch.dropped).toBe(0);
  });

  it('rejects invalid capacities', () => {
    expect(() => new EventChannel(0, () => ({}))).toThrow(RangeError);
  });
});
