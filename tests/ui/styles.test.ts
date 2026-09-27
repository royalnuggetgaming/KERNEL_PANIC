import { describe, expect, it } from 'vitest';

interface NodeFs {
  readFileSync(path: URL, encoding: 'utf8'): string;
}

/**
 * Raw stylesheet text. Vitest's CSS pipeline empties `?raw` CSS imports, and the app tsconfig has no node types,
 * so node:fs is loaded through a computed specifier and typed locally.
 */
async function css(name: string): Promise<string> {
  const fs: NodeFs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'));
  return fs.readFileSync(new URL(`../../src/ui/styles/${name}`, import.meta.url), 'utf8');
}

describe('ui styles', () => {
  it('the Patch Bay backdrop is near-opaque so the HUD below never bleeds through', async () => {
    // Regression (Wave 3 browser smoke): the 0.62 overlay backdrop let the HUD timer and player panels show
    // through the shop header and panels.
    const m = /\.kp-overlay\.kp-shop\s*\{[^}]*background:\s*rgba\(var\(--kp-bg-rgb\),\s*([0-9.]+)\)/.exec(
      await css('shop.css'),
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(0.9);
  });

  it('vehicle stat values ("12 u/s", "95 dps") stay on one line', async () => {
    // Regression (Wave 3 browser smoke): a 3.5em value column wrapped units onto a second line that overlapped
    // the next stat row.
    const text = await css('select.css');
    expect(/\.kp-stat-value\s*\{[^}]*white-space:\s*nowrap/.test(text)).toBe(true);
    const col = /\.kp-stat\s*\{[^}]*grid-template-columns:\s*[0-9.]+em\s+1fr\s+([0-9.]+)em/.exec(text);
    expect(col).not.toBeNull();
    expect(Number(col![1])).toBeGreaterThanOrEqual(5);
  });

  it('element resets never out-rank single-class component rules (VISUAL-1)', async () => {
    // Regression (round-1 visual critic): `.kp-ui button` (0,1,1) beat `.kp-row-lock`, `.kp-menu-item`,
    // `.kp-btn`, `.kp-shop-ready` ... (0,1,0): "55LOCK" glued together, no dim/selected menu contrast.
    const base = await css('base.css');
    expect(base).not.toMatch(/^\.kp-ui (button|h1|h2|h3|p|pre)\b[^{]*\{/m);
    expect(base).toMatch(/^:where\(\.kp-ui\) button\s*\{/m);
  });

  it('text over the live arena has backing plates and overlays hide what is under them (VISUAL-6)', async () => {
    const screens = await css('screens.css');
    const hud = await css('hud.css');
    // Main-menu tagline and menu sit on translucent plates.
    expect(/\.kp-tagline\s*\{[^}]*background:\s*rgba/.test(screens)).toBe(true);
    expect(/\.kp-menu-box\s*\{[^}]*background:\s*rgba/.test(screens)).toBe(true);
    // Top HUD readout has a plate.
    expect(/\.kp-hud-top\s*\{[^}]*background:/.test(hud)).toBe(true);
    // The HUD is not drawn while the Patch Bay is up.
    expect(hud).toMatch(/:has\(> \.kp-shop:not\(\[hidden\]\)\) > \.kp-hud\s*\{[^}]*visibility:\s*hidden/);
    // The pause panel is near-opaque over the shop rows.
    const m = /\.kp-pause-box\s*\{[^}]*background:\s*rgba\(var\(--kp-panel-rgb\),\s*([0-9.]+)\)/.exec(
      screens,
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(0.9);
  });

  it('the Firmware panel starts below the 3D voxel title (VISUAL-6)', async () => {
    const shop = await css('shop.css');
    const m = /\.kp-hangar\s*\{[^}]*padding-top:\s*([0-9.]+)vh/.exec(shop);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(22);
  });

  it('the countdown digit / round score gets its own large style (VISUAL-5)', async () => {
    const hud = await css('hud.css');
    const m = /\.kp-banner\.is-count \.kp-banner-sub\s*\{[^}]*font-size:\s*clamp\(([0-9.]+)em/.exec(hud);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(2);
  });
});
