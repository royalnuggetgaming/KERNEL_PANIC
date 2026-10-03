/**
 * MANUAL.md renderer: the same HOW TO PLAY pages as the in-game manual, as Markdown (consecutive term rows become
 * a two-column table). tests/states/manualDoc.test.ts keeps the checked-in MANUAL.md equal to this output
 * (regenerate with `UPDATE_MANUAL=1 npx vitest run tests/states/manualDoc.test.ts`).
 */
import type { ManualBlockVM, ManualPageVM } from '../contracts/ui';
import { CHEATS } from '../config/cheats';

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

/**
 * The TERMINAL cheat-code spoiler section (MANUAL.md only; the in-game manual just hints that a terminal
 * exists), inside a collapsed <details> block.
 */
export function cheatSpoilerMarkdown(metaCurrency: string): readonly string[] {
  const out: string[] = [
    '## SPOILERS: Terminal cheat codes',
    '',
    '<details>',
    '<summary>Click to reveal the codes (spoilers!)</summary>',
    '',
    `Open **TERMINAL** on the main menu and type a code, then Enter (case does not matter; Escape closes). A right code unlocks the cheat for good and switches it on for your next runs; switch cheats on/off in the terminal (Up/Down + Enter, or click) or in the FIRMWARE hangar. Type \`OFF\` to switch all off. **Cheat runs pay no ${metaCurrency} and never count for records or the leaderboard.** Cheats never apply in VERSUS.`,
    '',
    '| Code | Cheat | Effect |',
    '| --- | --- | --- |',
  ];
  for (const c of CHEATS) out.push(`| \`${c.code}\` | ${cell(c.label)} | ${cell(c.desc)} |`);
  out.push('', '</details>', '');
  return out;
}

/** The whole manual as Markdown (title, intro, table of contents, one section per page, optional appendix). */
export function manualMarkdown(
  title: string,
  pages: readonly ManualPageVM[],
  appendix: readonly string[] = [],
): string {
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
  out.push(...appendix);
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}
