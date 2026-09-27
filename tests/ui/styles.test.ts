import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function css(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src/ui/styles/${name}`, import.meta.url)), 'utf8');
}

describe('ui styles', () => {
  it('the Patch Bay backdrop is near-opaque so the HUD below never bleeds through', () => {
    // Regression (Wave 3 browser smoke): the 0.62 overlay backdrop let the HUD timer and player panels show
    // through the shop header and panels.
    const m = /\.kp-overlay\.kp-shop\s*\{[^}]*background:\s*rgba\(var\(--kp-bg-rgb\),\s*([0-9.]+)\)/.exec(
      css('shop.css'),
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(0.9);
  });
});
