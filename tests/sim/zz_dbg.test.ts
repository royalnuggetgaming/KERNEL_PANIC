import { it } from 'vitest';
import { SIM } from '../../src/config/tuning';
import { stepProjectiles } from '../../src/entities/projectiles';
import { stepCollision } from '../../src/sim/collision';
import { addTestPlayerShot, createTestWorld, placePlayer } from '../helpers/worldFixture';
it('dbg', () => {
  const vs = createTestWorld({ mode: 'versus', vehicles: ['lancer', 'lancer'] });
  placePlayer(vs, 0, 0, 0);
  placePlayer(vs, 1, 5, 0);
  const s = addTestPlayerShot(vs, 0, 1, 0, 60, 0, 10);
  const I = { moveX: 0, moveZ: 0, fireHeld: false, focusHeld: false, dashPressed: false, specialPressed: false };
  for (let i = 0; i < 5; i++) {
    stepProjectiles(vs, [I, I], SIM.DT);
    console.log(s.prevX, s.x, s.life, vs.playerShots.isAlive(s));
    stepCollision(vs, [I, I], SIM.DT);
    console.log('after', vs.playerShots.isAlive(s), vs.players[1].hp, vs.players[1].life);
  }
});
