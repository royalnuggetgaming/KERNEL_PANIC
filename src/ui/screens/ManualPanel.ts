/**
 * HOW TO PLAY sub-panel (MainMenu and Pause): a clickable table of contents on the left, the open page on the
 * right (headings, paragraphs and term/explanation rows), PREV / NEXT / BACK buttons and a page counter.
 * Keyboard navigation happens in states/subPanels.ts; clicks map to 'manual:<index>' confirm intents.
 */
import type { ManualBlockVM, ManualVM } from '../../contracts/ui';
import { ClassSwitch, Flag, Shown, TextSlot, ViewPool, button, h, markClick, AttrSlot } from '../dom';

/** Pointer item id prefix of a table-of-contents entry (mirrors states/subPanels.ts MANUAL_PAGE_PREFIX). */
export const MANUAL_ITEM_PREFIX = 'manual:';

const BLOCK_CLASS: Readonly<Record<ManualBlockVM['kind'], string>> = {
  h: 'kp-mb-h',
  p: 'kp-mb-p',
  item: 'kp-mb-item',
};

class TocEntry {
  readonly el: HTMLButtonElement;
  readonly label: TextSlot;
  readonly item: AttrSlot;
  readonly current: Flag;

  constructor(doc: Document) {
    this.el = h(doc, 'button', {
      className: 'kp-manual-toc-item',
      attrs: { type: 'button', tabindex: '-1' },
    });
    markClick(this.el, 'confirm', 'any', null);
    this.label = new TextSlot(this.el);
    this.item = new AttrSlot(this.el, 'data-item');
    this.current = new Flag(this.el, 'is-cursor');
  }
}

class BlockView {
  readonly el: HTMLDivElement;
  private readonly term: TextSlot;
  private readonly termShown: Shown;
  private readonly text: TextSlot;
  private readonly kind: ClassSwitch;

  constructor(doc: Document) {
    const termEl = h(doc, 'span', { className: 'kp-mb-term' });
    const textEl = h(doc, 'span', { className: 'kp-mb-text' });
    this.el = h(doc, 'div', { className: 'kp-mb' }, termEl, textEl);
    this.term = new TextSlot(termEl);
    this.termShown = new Shown(termEl, false);
    this.text = new TextSlot(textEl);
    this.kind = new ClassSwitch(this.el);
  }

  set(b: ManualBlockVM): void {
    this.kind.set(BLOCK_CLASS[b.kind]);
    this.termShown.set(b.kind === 'item');
    this.term.set(b.term);
    this.text.set(b.text);
  }
}

export class ManualPanel {
  readonly el: HTMLDivElement;
  private readonly toc: ViewPool<TocEntry>;
  private readonly blocks: ViewPool<BlockView>;
  private readonly title: TextSlot;
  private readonly counter: TextSlot;
  private readonly hint: TextSlot;
  private readonly pageEl: HTMLElement;
  private lastPage = -1;
  private lastPages: ManualVM['pages'] | null = null;

  constructor(doc: Document) {
    const tocEl = h(doc, 'nav', { className: 'kp-manual-toc' });
    const titleEl = h(doc, 'h3', { className: 'kp-manual-title' });
    const blocksEl = h(doc, 'div', { className: 'kp-manual-blocks' });
    this.pageEl = h(doc, 'article', { className: 'kp-manual-page' }, titleEl, blocksEl);
    const counterEl = h(doc, 'span', { className: 'kp-manual-counter kp-dim' });
    const hintEl = h(doc, 'p', { className: 'kp-manual-hint kp-dim' });
    this.el = h(
      doc,
      'div',
      { className: 'kp-panel kp-manual' },
      h(
        doc,
        'header',
        { className: 'kp-manual-head' },
        h(doc, 'h2', { className: 'kp-panel-title', text: 'HOW TO PLAY' }),
        counterEl,
      ),
      h(doc, 'div', { className: 'kp-manual-body' }, tocEl, this.pageEl),
      h(
        doc,
        'footer',
        { className: 'kp-manual-foot' },
        button(doc, 'kp-btn kp-manual-prev', '◀ PREV', 'left', 'any', 'manualPrev'),
        hintEl,
        button(doc, 'kp-btn kp-manual-next', 'NEXT ▶', 'right', 'any', 'manualNext'),
        button(doc, 'kp-btn kp-back', 'BACK', 'back', 'any', 'back'),
      ),
    );
    this.toc = new ViewPool(tocEl, () => new TocEntry(doc));
    this.blocks = new ViewPool(blocksEl, () => new BlockView(doc));
    this.title = new TextSlot(titleEl);
    this.counter = new TextSlot(counterEl);
    this.hint = new TextSlot(hintEl);
  }

  render(vm: ManualVM): void {
    const pages = vm.pages;
    if (pages !== this.lastPages) {
      this.lastPages = pages;
      this.lastPage = -1;
      this.toc.ensure(pages.length);
      for (let i = 0; i < pages.length; i++) {
        const e = this.toc.get(i);
        e.label.set(pages[i]!.title);
        e.item.set(MANUAL_ITEM_PREFIX + String(i));
      }
    }
    this.hint.set(vm.hint);
    if (vm.page === this.lastPage) return;
    this.lastPage = vm.page;
    for (let i = 0; i < pages.length; i++) this.toc.get(i).current.set(i === vm.page);
    const page = pages[vm.page];
    this.counter.set(page === undefined ? '' : `${vm.page + 1} / ${pages.length}`);
    this.title.set(page === undefined ? '' : page.title);
    const blocks = page === undefined ? [] : page.blocks;
    this.blocks.ensure(blocks.length);
    for (let i = 0; i < blocks.length; i++) this.blocks.get(i).set(blocks[i]!);
    this.pageEl.scrollTop = 0;
  }
}
