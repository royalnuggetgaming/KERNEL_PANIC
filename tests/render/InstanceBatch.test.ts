import { BoxGeometry, ShaderMaterial, type InterleavedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { INSTANCE_LAYOUT } from '../../src/contracts/render';
import { GpuRingBuffer } from '../../src/render/GpuRingBuffer';
import { InstanceBatch } from '../../src/render/InstanceBatch';

function ranges(attr: InterleavedBufferAttribute): { start: number; count: number }[] {
  return attr.data.updateRanges.map((r) => ({ start: r.start, count: r.count }));
}

describe('InstanceBatch (three 0.186, node)', () => {
  it('dense push/commit sets instanceCount and one update range', () => {
    const b = new InstanceBatch(new BoxGeometry(), new ShaderMaterial(), 4);
    const aT = b.geometry.getAttribute('aT') as InterleavedBufferAttribute;
    expect(aT.data.stride).toBe(INSTANCE_LAYOUT.stride);
    b.begin();
    b.push(1, 2, 0.5, 1, 0, 0, 0, 7);
    b.push(3, 4, 0.5, 1, 0, 0, 0, 8);
    const v0 = aT.data.version;
    b.commit();
    expect(b.geometry.instanceCount).toBe(2);
    expect(b.mesh.visible).toBe(true);
    expect(ranges(aT)).toEqual([{ start: 0, count: 16 }]);
    expect(aT.data.version).toBe(v0 + 1);
    expect(Array.from(b.data.subarray(8, 16))).toEqual([3, 4, 0.5, 1, 0, 0, 0, 8]);
    const rangeObj = aT.data.updateRanges[0];
    b.begin();
    b.push(0, 0, 0, 1, 0, 0, 0, 0);
    b.commit();
    expect(aT.data.updateRanges[0]).toBe(rangeObj);
    b.begin();
    b.commit();
    expect(b.mesh.visible).toBe(false);
  });

  it('ignores pushes beyond capacity and supports sparse writes', () => {
    const b = new InstanceBatch(new BoxGeometry(), new ShaderMaterial(), 2);
    b.begin();
    expect(b.push(0, 0, 0, 1, 0, 0, 0, 0)).toBe(0);
    expect(b.push(0, 0, 0, 1, 0, 0, 0, 0)).toBe(1);
    expect(b.push(0, 0, 0, 1, 0, 0, 0, 0)).toBe(-1);
    b.setCount(2);
    b.writeAt(1, 9, 9, 0, 1, 0, 0, 0, 0);
    b.commit(false);
    const aT = b.geometry.getAttribute('aT') as InterleavedBufferAttribute;
    expect(ranges(aT)).toEqual([{ start: 8, count: 8 }]);
  });
});

describe('GpuRingBuffer', () => {
  it('claims wrap around and commit emits at most 2 ranges', () => {
    const r = new GpuRingBuffer(new BoxGeometry(), new ShaderMaterial(), 4, 6, [
      { name: 'aP0', size: 3, offset: 0 },
      { name: 'aT0', size: 3, offset: 3 },
    ]);
    expect(r.geometry.instanceCount).toBe(4);
    for (let i = 0; i < 3; i++) r.claim();
    r.commit();
    const a = r.geometry.getAttribute('aP0') as InterleavedBufferAttribute;
    expect(ranges(a)).toEqual([{ start: 0, count: 18 }]);
    r.claim();
    expect(r.claim()).toBe(0);
    r.commit();
    expect(ranges(a)).toEqual([
      { start: 18, count: 6 },
      { start: 0, count: 6 },
    ]);
    expect(r.mesh.visible).toBe(true);
    expect(
      () =>
        new GpuRingBuffer(new BoxGeometry(), new ShaderMaterial(), 2, 3, [{ name: 'x', size: 4, offset: 0 }]),
    ).toThrow(RangeError);
    r.reset();
    expect(r.totalWritten).toBe(0);
    expect(r.mesh.visible).toBe(false);
  });
});
