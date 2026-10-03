/** Chromebook quality preset (Lenovo 500e Gen 3 class): preset data, auto-detect, boot choice, governor floor. */
import { BoxGeometry, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS } from '../../src/contracts/save';
import {
  CHROMEBOOK_TOAST,
  GOVERNOR,
  QUALITY_PRESETS,
  chooseBootQuality,
  effectiveFrameCap,
  isLowPowerChromebook,
  parseQualityOverride,
  type PlatformHints,
} from '../../src/config/quality';
import { CAPACITY } from '../../src/config/tuning';
import { createResolutionGovernor } from '../../src/engine/ResolutionGovernor';
import { GpuRingBuffer } from '../../src/render/GpuRingBuffer';
import { BLOOM_DOWNSAMPLES } from '../../src/render/PostFX';
import { MAX_DIGITS_PER_FRAME } from '../../src/render/fx/DamageNumbers';

const CROS_UA =
  'Mozilla/5.0 (X11; CrOS x86_64 15633.69.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const hints = (userAgent: string, cores: number, uaPlatform: string | null = null): PlatformHints => ({
  userAgent,
  uaPlatform,
  hardwareConcurrency: cores,
});

describe('chromebook quality preset', () => {
  const cb = QUALITY_PRESETS.chromebook;

  it('is a known quality level, appended after the original four', () => {
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high', 'ultra', 'chromebook']);
  });

  it('caps DPR at 1, no MSAA, quarter-res bloom with fewer passes, 60 fps, LOW_FX shaders', () => {
    expect(cb.dprCap).toBe(1);
    expect(cb.msaa).toBe(0);
    expect(cb.bloomRes).toBe(0.25);
    expect(cb.bloomLevels).toBeLessThan(BLOOM_DOWNSAMPLES);
    expect(cb.bloomLevels).toBeGreaterThanOrEqual(1);
    expect(cb.maxFps).toBe(60);
    expect(cb.lowFx).toBe(true);
    expect(cb.renderScaleFloor).toBe(0.5);
  });

  it('trims only pure-FX budgets (particles ~2048, digits, shockwaves)', () => {
    expect(cb.particleCap).toBe(2048);
    expect(cb.particleCap).toBeLessThan(CAPACITY.particles);
    expect(cb.digitsPerFrame).toBeLessThan(MAX_DIGITS_PER_FRAME);
    expect(cb.digitCap).toBeLessThan(CAPACITY.digits);
    expect(cb.shockwaveCap).toBeLessThan(CAPACITY.shockwaves);
  });

  it('leaves the other presets on the full shader and FX budgets', () => {
    for (const q of ['low', 'medium', 'high', 'ultra'] as const) {
      const p = QUALITY_PRESETS[q];
      expect(p.lowFx).toBe(false);
      expect(p.maxFps).toBeNull();
      expect(p.bloomLevels).toBe(BLOOM_DOWNSAMPLES);
      expect(p.digitsPerFrame).toBe(MAX_DIGITS_PER_FRAME);
      expect(p.digitCap).toBe(CAPACITY.digits);
      expect(p.shockwaveCap).toBe(CAPACITY.shockwaves);
      expect(p.renderScaleFloor).toBe(0.6);
    }
  });

  it('clamps the FRAME CAP setting to 60 on Chromebook only', () => {
    for (const cap of ['auto', 60, 120, 'uncapped'] as const) {
      expect(effectiveFrameCap(cap, QUALITY_PRESETS.chromebook)).toBe(60);
      expect(effectiveFrameCap(cap, QUALITY_PRESETS.high)).toBe(cap);
    }
  });

  it('lets the governor go down to 0.5 render scale on Chromebook (others stop at 0.6)', () => {
    expect(GOVERNOR.RENDER_SCALES).toContain(0.5);
    const scales = (q: 'chromebook' | 'high' | 'low'): number[] => {
      const g = createResolutionGovernor(QUALITY_PRESETS[q]);
      const out: number[] = [];
      let t = 0;
      for (let i = 0; i < 40; i++) {
        t += 2.5;
        const a = g.evaluate(t, 40, true);
        if (a?.kind === 'renderScale') out.push(a.value);
      }
      return out;
    };
    expect(scales('chromebook')).toEqual([0.85, 0.72, 0.6, 0.5]);
    expect(scales('high')).toEqual([0.85, 0.72, 0.6]);
    expect(createResolutionGovernor(QUALITY_PRESETS.chromebook).maxStep).toBe(5);
    expect(createResolutionGovernor(QUALITY_PRESETS.low).maxStep).toBe(4);
  });
});

describe('Chromebook auto-detect (pure)', () => {
  it('detects ChromeOS from the UA or UA-CH platform with <= 4 logical cores', () => {
    expect(isLowPowerChromebook(hints(CROS_UA, 2))).toBe(true);
    expect(isLowPowerChromebook(hints(CROS_UA, 4))).toBe(true);
    expect(isLowPowerChromebook(hints(MAC_UA, 4, 'Chrome OS'))).toBe(true);
    expect(isLowPowerChromebook(hints(CROS_UA, 8))).toBe(false);
    expect(isLowPowerChromebook(hints(CROS_UA, 0))).toBe(false);
    expect(isLowPowerChromebook(hints(MAC_UA, 4, 'macOS'))).toBe(false);
    expect(isLowPowerChromebook(hints(MAC_UA, 2))).toBe(false);
  });

  it('first boot on a Chromebook picks chromebook and asks for the toast', () => {
    expect(chooseBootQuality(null, null, hints(CROS_UA, 4))).toEqual({
      quality: 'chromebook',
      autoChromebook: true,
    });
    expect(chooseBootQuality(null, null, hints(MAC_UA, 8))).toEqual({
      quality: 'high',
      autoChromebook: false,
    });
    expect(CHROMEBOOK_TOAST).toBe('Chromebook mode on — change in Settings > Quality');
  });

  it('never overrides a saved choice; the URL override wins and is not an auto pick', () => {
    expect(chooseBootQuality('ultra', null, hints(CROS_UA, 2))).toEqual({
      quality: 'ultra',
      autoChromebook: false,
    });
    expect(chooseBootQuality('high', null, hints(CROS_UA, 2)).quality).toBe('high');
    expect(chooseBootQuality('high', 'chromebook', hints(MAC_UA, 8))).toEqual({
      quality: 'chromebook',
      autoChromebook: false,
    });
    expect(chooseBootQuality(null, 'low', hints(CROS_UA, 2))).toEqual({
      quality: 'low',
      autoChromebook: false,
    });
  });

  it('parses ?quality= case-insensitively and ignores unknown levels', () => {
    expect(parseQualityOverride('chromebook', QUALITY_LEVELS)).toBe('chromebook');
    expect(parseQualityOverride(' ChromeBook ', QUALITY_LEVELS)).toBe('chromebook');
    expect(parseQualityOverride('potato', QUALITY_LEVELS)).toBeNull();
    expect(parseQualityOverride(null, QUALITY_LEVELS)).toBeNull();
  });
});

describe('GpuRingBuffer.setLimit (pure-FX ring budgets)', () => {
  it('wraps claims at the limit and draws only that many instances', () => {
    const r = new GpuRingBuffer(new BoxGeometry(), new ShaderMaterial(), 8, 4, [
      { name: 'a', size: 4, offset: 0 },
    ]);
    expect(r.geometry.instanceCount).toBe(8);
    r.setLimit(3);
    expect(r.activeLimit).toBe(3);
    expect(r.geometry.instanceCount).toBe(3);
    const offsets = [r.claim(), r.claim(), r.claim(), r.claim()];
    expect(offsets).toEqual([0, 4, 8, 0]);
    r.commit();
    r.setLimit(100);
    expect(r.activeLimit).toBe(8);
    r.setLimit(0);
    expect(r.activeLimit).toBe(1);
  });
});
