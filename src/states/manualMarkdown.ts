/**
 * MANUAL.md renderer: the same HOW TO PLAY pages as the in-game manual, as Markdown (consecutive term rows become
 * a two-column table). tests/states/manualDoc.test.ts keeps the checked-in MANUAL.md equal to this output
 * (regenerate with `UPDATE_MANUAL=1 npx vitest run tests/states/manualDoc.test.ts`).
 */
import type { ManualBlockVM, ManualPageVM } from '../contracts/ui';

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/ +/g, '-');
}

function renderBlocks(blocks: readonly ManualBlockVM[], out: string[]): void {
  let inTable = false;
  for (const b of blocks) {
    if (b.kind === 'item') {
      if (!inTable) {
        out.push('| | |', '| --- | --- |');
        inTable = true;
      }
      out.push(`| **${cell(b.term)}** | ${cell(b.text)} |`);
      continue;
    }
    if (inTable) {
      out.push('');
      inTable = false;
    }
    if (b.kind === 'h') out.push(`### ${b.text}`, '');
    else out.push(b.text, '');
  }
  if (inTable) out.push('');
}

/** The whole manual as Markdown (title, intro, table of contents, one section per page). */
export function manualMarkdown(title: string, pages: readonly ManualPageVM[]): string {
  const out: string[] = [
    `# ${title}: How to Play`,
    '',
    'This manual is also in the game: **HOW TO PLAY** on the main menu and in the pause menu. It is generated from',
    'the game data (`src/states/manualPages.ts`), so the numbers match the current build. Keys are the defaults;',
    'the in-game manual shows your own bindings.',
    '',
    '## Contents',
    '',
  ];
  for (let i = 0; i < pages.length; i++)
    out.push(`${i + 1}. [${pages[i]!.title}](#${slug(pages[i]!.title)})`);
  out.push('');
  for (const p of pages) {
    out.push(`## ${p.title}`, '');
    renderBlocks(p.blocks, out);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}
