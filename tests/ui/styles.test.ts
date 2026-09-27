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
});
