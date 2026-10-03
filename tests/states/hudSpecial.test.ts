import { describe, expect, it } from 'vitest';
import type { Bindings } from '../../src/contracts/input';
import { DEFAULT_BINDINGS } from '../../src/config/keys';
import { OVERDRIVE } from '../../src/config/tuning';
import { stepSpecials } from '../../src/entities/specials';
import { HudVmWriter } from '../../src/states/hudViewModel';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { createIntents } from '../helpers/scriptedIntents';
import { createTestWorld, stepSystem } from '../helpers/worldFixture';

describe('HUD special fields', () => {
  it('label = theme name + live first Special key, rebuilt when the binding changes', () => {
    const w = createTestWorld({ mode: 'coop', vehicles: ['lancer', 'tinker'] });
    let b: Bindings = DEFAULT_BINDINGS;
    const hud = new HudVmWriter(KERNEL_PANIC, null, () => b);
    let vm = hud.write(w, null);
    expect(vm.players[0].specialLabel).toBe('RAILBURST [E]');
    expect(vm.players[1].specialLabel).toBe('PATCH DRONE [,]');
    const same = hud.write(w, null).players[0].specialLabel;
    expect(same).toBe(vm.players[0].specialLabel);
    b = {
      ...DEFAULT_BINDINGS,
      players: [{ ...DEFAULT_BINDINGS.players[0], special: ['KeyQ'] }, DEFAULT_BINDINGS.players[1]],
    };
    vm = hud.write(w, null);
    expect(vm.players[0].specialLabel).toBe('RAILBURST [Q]');
    expect(new HudVmWriter(KERNEL_PANIC).write(w, null).players[0].specialLabel).toBe('RAILBURST');
  });

  it('percent and active fraction follow the meter and the running special', () => {
    const w = createTestWorld({ mode: 'solo', vehicles: ['bulwark', 'bulwark'] });
    w.run.phase = 'combat';
    const hud = new HudVmWriter(KERNEL_PANIC);
    w.players[0].overdrive = OVERDRIVE.MAX * 0.735;
    expect(hud.write(w, null).players[0].specialPercent).toBe(73);
    w.players[0].overdrive = OVERDRIVE.MAX;
    let vm = hud.write(w, null);
    expect(vm.players[0].specialPercent).toBe(100);
    expect(vm.players[0].specialActiveFrac).toBe(0);
    const it = createIntents();
    it[0].specialPressed = true;
    stepSystem(w, stepSpecials, 1, it);
    vm = hud.write(w, null);
    expect(vm.players[0].specialPercent).toBe(0);
    expect(vm.players[0].specialActiveFrac).toBeGreaterThan(0.99);
  });
});
