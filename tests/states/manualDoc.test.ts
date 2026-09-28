import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../../src/config/keys';
import { manualMarkdown } from '../../src/states/manualMarkdown';
import { buildManualPages } from '../../src/states/manualPages';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';

interface NodeFs {
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string, encoding: 'utf8'): void;
}

interface NodeProcess {
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** node:fs / node:process through computed specifiers (the app tsconfig has no node types), typed locally. */
async function node(): Promise<{ fs: NodeFs; proc: NodeProcess }> {
  const fs: NodeFs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'));
  const proc: NodeProcess = await import(/* @vite-ignore */ ['node', 'process'].join(':'));
  return { fs, proc };
}

/** Prettier re-pads tables; compare cell contents only. */
function normalize(md: string): string {
  const out: string[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('|')) {
      const cells = line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/\s+/g, ' '));
      out.push(cells.every((c) => /^:?-+:?$/.test(c)) ? '|---|' : cells.join(' | '));
    } else if (!(line === '' && out[out.length - 1] === '')) out.push(line);
  }
  return out.join('\n').trim();
}

const MANUAL = new URL('../../MANUAL.md', import.meta.url);

describe('MANUAL.md', () => {
  it('matches the in-game HOW TO PLAY pages (regenerate: UPDATE_MANUAL=1 npx vitest run tests/states/manualDoc.test.ts, then prettier)', async () => {
    const { fs, proc } = await node();
    const md = manualMarkdown(KERNEL_PANIC.title, buildManualPages(KERNEL_PANIC, DEFAULT_BINDINGS));
    if (proc.env.UPDATE_MANUAL === '1') fs.writeFileSync(MANUAL, md, 'utf8');
    expect(normalize(fs.readFileSync(MANUAL, 'utf8'))).toBe(normalize(md));
  });

  it('renders term rows as tables and pages as sections', () => {
    const md = manualMarkdown('X', [
      {
        id: 'a',
        title: 'Page A',
        blocks: [
          { kind: 'p', term: '', text: 'Intro' },
          { kind: 'item', term: 'Move', text: 'W | A' },
          { kind: 'h', term: '', text: 'Sub' },
        ],
      },
    ]);
    expect(md).toContain('1. [Page A](#page-a)');
    expect(md).toContain('## Page A\n\nIntro\n\n| | |\n| --- | --- |\n| **Move** | W \\| A |\n\n### Sub');
  });
});
