/** Block builders shared by the HOW TO PLAY page modules (manualPages.ts, manualReference.ts). */
import type { ManualBlockVM, ManualPageVM } from '../contracts/ui';
import { trimNum } from './powerupText';

export function hd(text: string): ManualBlockVM {
  return { kind: 'h', term: '', text };
}

export function para(text: string): ManualBlockVM {
  return { kind: 'p', term: '', text };
}

export function item(term: string, text: string): ManualBlockVM {
  return { kind: 'item', term, text };
}

export function page(id: string, title: string, blocks: readonly ManualBlockVM[]): ManualPageVM {
  return { id, title, blocks };
}

export function pctText(x: number): string {
  return `${trimNum(x * 100)}%`;
}
