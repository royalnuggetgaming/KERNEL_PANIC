/**
 * Minimal fake DOM for node-environment UI tests: just the Element/Document surface ui/ uses (createElement,
 * appendChild/removeChild, className/classList, attributes, textContent, hidden, style.transform/setProperty,
 * add/removeEventListener). Counts text writes so tests can assert diffing.
 */

type Listener = (e: FakeEvent) => void;

export class FakeEvent {
  readonly type: string;
  readonly target: FakeElement;
  defaultPrevented = false;

  constructor(type: string, target: FakeElement) {
    this.type = type;
    this.target = target;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class FakeClassList {
  private readonly owner: FakeElement;

  constructor(owner: FakeElement) {
    this.owner = owner;
  }

  private get set(): Set<string> {
    return this.owner.classSet;
  }

  add(...cls: string[]): void {
    // Like the real DOMTokenList: an empty token throws (a ClassSwitch fed '' crashed the v3 TERMINAL).
    for (const c of cls) if (c === '') throw new SyntaxError('DOMTokenList.add: the token must not be empty');
    for (const c of cls) this.set.add(c);
    this.owner.classWrites++;
  }

  remove(...cls: string[]): void {
    for (const c of cls) this.set.delete(c);
    this.owner.classWrites++;
  }

  toggle(cls: string, force?: boolean): boolean {
    const on = force ?? !this.set.has(cls);
    if (on) this.set.add(cls);
    else this.set.delete(cls);
    this.owner.classWrites++;
    return on;
  }

  contains(cls: string): boolean {
    return this.set.has(cls);
  }
}

class FakeStyle {
  private readonly props = new Map<string, string>();
  private t = '';
  transformWrites = 0;

  get transform(): string {
    return this.t;
  }

  set transform(v: string) {
    this.t = v;
    this.transformWrites++;
  }

  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.props.get(name) ?? '';
  }
}

export class FakeElement {
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  readonly classSet = new Set<string>();
  readonly classList: FakeClassList;
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();
  private readonly styleObj = new FakeStyle();
  private ownText = '';
  hidden = false;
  textWrites = 0;
  classWrites = 0;
  scrollTop = 0;
  /** scrollIntoView calls (the shop and hangar keep the cursor row visible). */
  scrollIntoViewCalls = 0;

  constructor(doc: FakeDocument, tag: string) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.classList = new FakeClassList(this);
  }

  get parentNode(): FakeElement | null {
    return this.parentElement;
  }

  get style(): FakeStyle {
    return this.styleObj;
  }

  get className(): string {
    return [...this.classSet].join(' ');
  }

  set className(v: string) {
    this.classSet.clear();
    for (const c of v.split(/\s+/)) if (c !== '') this.classSet.add(c);
  }

  get textContent(): string {
    let s = this.ownText;
    for (const c of this.children) s += c.textContent;
    return s;
  }

  set textContent(v: string) {
    for (const c of this.children) c.parentElement = null;
    this.children.length = 0;
    this.ownText = v;
    this.textWrites++;
  }

  appendChild<T extends FakeElement>(c: T): T {
    if (c.parentElement !== null) c.parentElement.removeChild(c);
    c.parentElement = this;
    this.children.push(c);
    return c;
  }

  removeChild<T extends FakeElement>(c: T): T {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentElement = null;
    return c;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((f) => f !== fn),
    );
  }

  listenerCount(type: string): number {
    return (this.listeners.get(type) ?? []).length;
  }

  /** Dispatches an event at this element, bubbling to the ancestors. */
  dispatch(type: string): FakeEvent {
    const e = new FakeEvent(type, this);
    this.fire(type, e);
    let node = this.parentElement;
    while (node !== null) {
      node.fire(type, e);
      node = node.parentElement;
    }
    return e;
  }

  private fire(type: string, e: FakeEvent): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }

  scrollIntoView(): void {
    this.scrollIntoViewCalls++;
  }

  /** Depth-first descendants (inclusive) matching a predicate. */
  findAll(pred: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      if (pred(el)) out.push(el);
      for (const c of el.children) walk(c);
    };
    walk(this);
    return out;
  }

  byClass(cls: string): FakeElement[] {
    return this.findAll((el) => el.classSet.has(cls));
  }

  first(cls: string): FakeElement {
    const el = this.byClass(cls)[0];
    if (el === undefined) throw new Error(`no .${cls}`);
    return el;
  }

  byAttr(name: string, value: string): FakeElement[] {
    return this.findAll((el) => el.getAttribute(name) === value);
  }

  /** True when neither this element nor an ancestor is hidden. */
  get visible(): boolean {
    if (this.hidden) return false;
    let node = this.parentElement;
    while (node !== null) {
      if (node.hidden) return false;
      node = node.parentElement;
    }
    return true;
  }
}

export class FakeDocument {
  readonly defaultView = null;
  created = 0;

  createElement(tag: string): FakeElement {
    this.created++;
    return new FakeElement(this, tag);
  }
}

export function asDocument(d: FakeDocument): Document {
  return d as unknown as Document;
}

export function asElement(e: FakeElement): HTMLElement {
  return e as unknown as HTMLElement;
}

export function asFake(e: HTMLElement): FakeElement {
  return e as unknown as FakeElement;
}
