import { describe, expect, it } from 'vitest';
import { createBootState, WEBGL2_MISSING } from '../../src/states/BootState';
import { FakeAssets } from '../helpers/fakePorts';
import { createFakeServices } from '../helpers/fakeServices';
import { settle } from './harness';

function rig() {
  const set = createFakeServices();
  const boot = createBootState(set.services);
  return { set, boot };
}

describe('BootState', () => {
  it('runs the pipeline with progress, applies the save, then waits for a key', async () => {
    const assets = new FakeAssets(false);
    const set = createFakeServices();
    const services = { ...set.services, assets };
    const boot = createBootState(services);
    boot.enter(undefined, null);
    expect(set.ui.vm('boot')?.phase).toBe('loading');
    await settle();
    boot.update(1 / 60);
    expect(set.save.rec.count('load')).toBe(1);
    expect(set.audio.rec.count('setVolumes')).toBe(1);
    expect(set.render.rec.count('applySettings')).toBe(1);
    expect(set.input.rec.count('setBindings')).toBe(1);
    expect(set.ui.vm('boot')?.progress).toBeCloseTo(0.45);
    assets.finishBuild();
    await settle();
    boot.update(1 / 60);
    expect(set.ui.vm('boot')?.label).toBe('Warming shaders');
    // A key during loading does not count.
    set.input.pressAnyKey();
    boot.update(1 / 60);
    assets.finishWarmup();
    await settle();
    boot.update(1 / 60);
    expect(set.ui.vm('boot')?.phase).toBe('ready');
    expect(set.ui.vm('boot')?.progress).toBe(1);
    expect(set.audio.unlocked).toBe(false);
    set.input.pressAnyKey();
    boot.update(1 / 60);
    await settle();
    boot.update(1 / 60);
    expect(set.audio.unlocked).toBe(true);
    expect(set.fsm.requests).toEqual([{ to: 'MainMenu', payload: undefined }]);
    boot.update(1 / 60);
    expect(set.fsm.requests).toHaveLength(1);
    boot.exit('MainMenu');
    expect(set.ui.visible.has('boot')).toBe(false);
  });

  it('a click on the boot screen also passes the gate', async () => {
    const { set, boot } = rig();
    boot.enter(undefined, null);
    await settle();
    boot.update(1 / 60);
    set.ui.click({ screen: 'boot', kind: 'confirm', player: 'any', itemId: 'boot' });
    boot.update(1 / 60);
    await settle();
    boot.update(1 / 60);
    expect(set.fsm.lastRequest()?.to).toBe('MainMenu');
  });

  it('shows the fatal panel without WebGL2', async () => {
    const { set, boot } = rig();
    set.render.capabilities = { webgl2: false, floatTargets: false };
    boot.enter(undefined, null);
    await settle();
    boot.update(1 / 60);
    const vm = set.ui.vm('boot');
    expect(vm?.phase).toBe('fatal');
    expect(vm?.error).toBe(WEBGL2_MISSING);
    set.input.pressAnyKey();
    boot.update(1 / 60);
    await settle();
    expect(set.fsm.requests).toHaveLength(0);
    expect(set.assets.rec.count('build')).toBe(0);
  });

  it('an asset build failure is fatal; the LDR fallback only logs', async () => {
    const { set, boot } = rig();
    set.render.capabilities = { webgl2: true, floatTargets: false };
    set.assets.failBuild = new Error('shader boom');
    boot.enter(undefined, null);
    await settle();
    boot.update(1 / 60);
    expect(set.ui.vm('boot')?.error).toBe('shader boom');
    expect(set.log.entries.some((e) => e.msg.includes('LDR'))).toBe(true);
  });

  it('toasts a non-ok save status', async () => {
    const { set, boot } = rig();
    set.save.status = 'restoredBackup';
    boot.enter(undefined, null);
    await settle();
    expect(set.ui.toasts[0]?.kind).toBe('warn');
  });

  it('explains a v1 -> v2 save upgrade (Firmware simplified, Cores refunded) once', async () => {
    const { set, boot } = rig();
    set.save.migratedFrom = 1;
    boot.enter(undefined, null);
    await settle();
    expect(set.ui.toasts.map((t) => t.msg).join(' ')).toMatch(
      /simplified: Cores spent on removed lines were refunded/,
    );
  });

  it('an audio unlock failure does not block the game', async () => {
    const { set, boot } = rig();
    set.audio.unlock = () => Promise.reject(new Error('no audio'));
    boot.enter(undefined, null);
    await settle();
    boot.update(1 / 60);
    set.input.pressAnyKey();
    boot.update(1 / 60);
    await settle();
    boot.update(1 / 60);
    expect(set.fsm.lastRequest()?.to).toBe('MainMenu');
    expect(set.log.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('a late pipeline step after exit is ignored', async () => {
    const assets = new FakeAssets(false);
    const set = createFakeServices();
    const boot = createBootState({ ...set.services, assets });
    boot.enter(undefined, null);
    await settle();
    boot.exit('MainMenu');
    assets.finishBuild();
    await settle();
    expect(assets.rec.count('warmup')).toBe(0);
  });
});
