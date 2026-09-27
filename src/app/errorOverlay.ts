/**
 * Fatal error overlay: window 'error' and 'unhandledrejection' show a panel with the message and a Reload
 * button (styled inline so it works even when the UI stylesheet failed). Benign browser noise
 * (ResizeObserver loop notifications) is ignored.
 */
export interface ErrorOverlayTarget {
  readonly window: Window;
  readonly document: Document;
  reload(): void;
}

const IGNORED = [/ResizeObserver loop/i];

function describe(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return 'Unknown error';
  }
}

function style(el: HTMLElement, css: Readonly<Record<string, string>>): void {
  for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v);
}

/** Installs the handlers; returns an uninstall function. */
export function installErrorOverlay(t: ErrorOverlayTarget): () => void {
  const doc = t.document;
  let panel: HTMLElement | null = null;
  let list: HTMLElement | null = null;
  let shown = 0;

  const ensurePanel = (): HTMLElement => {
    if (panel !== null && list !== null) return list;
    const root = doc.createElement('div');
    root.setAttribute('role', 'alertdialog');
    root.className = 'kp-fatal';
    style(root, {
      position: 'fixed',
      inset: '0',
      'z-index': '2147483647',
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
      background: 'rgba(5, 6, 13, 0.92)',
      color: '#e6f6ff',
      font: '14px/1.4 ui-monospace, Menlo, Consolas, monospace',
    });
    const box = doc.createElement('div');
    style(box, {
      'max-width': 'min(880px, 92vw)',
      'max-height': '86vh',
      overflow: 'auto',
      padding: '24px 28px',
      border: '1px solid #ff5a1f',
      'box-shadow': '0 0 24px rgba(255, 90, 31, 0.45)',
      background: '#0c1022',
    });
    const title = doc.createElement('h2');
    title.textContent = 'KERNEL PANIC: FATAL ERROR';
    style(title, { margin: '0 0 12px', color: '#ff5a1f', 'letter-spacing': '0.08em' });
    const msgs = doc.createElement('div');
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = 'RELOAD';
    style(button, {
      'margin-top': '16px',
      padding: '8px 20px',
      font: 'inherit',
      color: '#05060d',
      background: '#19e6ff',
      border: '0',
      cursor: 'pointer',
    });
    button.addEventListener('click', () => {
      t.reload();
    });
    box.append(title, msgs, button);
    root.appendChild(box);
    doc.body.appendChild(root);
    panel = root;
    list = msgs;
    return msgs;
  };

  const show = (text: string): void => {
    for (const re of IGNORED) if (re.test(text)) return;
    if (shown >= 8) return;
    shown++;
    const pre = doc.createElement('pre');
    pre.textContent = text;
    style(pre, { 'white-space': 'pre-wrap', margin: '0 0 8px', color: '#ffb199' });
    ensurePanel().appendChild(pre);
  };

  const onError = (e: ErrorEvent): void => {
    show(e.error !== undefined && e.error !== null ? describe(e.error) : e.message);
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    show(`Unhandled rejection: ${describe(e.reason)}`);
  };
  t.window.addEventListener('error', onError);
  t.window.addEventListener('unhandledrejection', onRejection);
  return () => {
    t.window.removeEventListener('error', onError);
    t.window.removeEventListener('unhandledrejection', onRejection);
    panel?.remove();
    panel = null;
    list = null;
  };
}
