/**
 * HOW TO PLAY "Chromebook" page (in-game manual and MANUAL.md): how the CHROMEBOOK quality preset auto-enables,
 * how to switch it, the ChromeOS keyboard (Search = Launcher key, no numpad) and tips for budget Chromebooks
 * such as the Lenovo 500e Chromebook Gen 3. Numbers come from config so a retune changes the text too.
 */
import type { ManualPageVM } from '../contracts/ui';
import { QUALITY_PRESETS } from '../config/quality';
import { hd, item, page, para } from './manualBlocks';

export function chromebookPage(): ManualPageVM {
  const cb = QUALITY_PRESETS.chromebook;
  return page('chromebook', 'Chromebook', [
    para(
      'KERNEL PANIC runs on budget Chromebooks such as the Lenovo 500e Chromebook Gen 3 (Intel Celeron, 11.6" 1366x768 touchscreen). The CHROMEBOOK quality setting keeps it smooth there.',
    ),
    item(
      'Turn it on',
      'SETTINGS > CHROMEBOOK MODE (the first row): set it ON, then choose RESTART TO APPLY. Your progress is kept. Set it OFF to go back to the normal HIGH quality.',
    ),
    item(
      'Auto-detect',
      'On a brand-new save (the first launch ever in that browser) on a ChromeOS device with 4 or fewer CPU threads, it switches on by itself and a message says so. If the game was opened in that browser before, use the setting.',
    ),
    item(
      'What it changes',
      `Only looks: native screen pixels, no MSAA, cheaper glow and floor/sky effects, up to ${cb.particleCap} particles, fewer damage numbers and a ${String(cb.maxFps)} FPS cap. In busy fights the picture may drop to ${String(cb.renderScaleFloor * 100)}% resolution. Enemies, bullets, timing and rules are exactly the same.`,
    ),
    item(
      'Fine-tune',
      'SETTINGS > QUALITY also lists CHROMEBOOK next to LOW / MEDIUM / HIGH / ULTRA. Most of a change is instant; the cheaper floor/sky effects switch after RESTART TO APPLY.',
    ),
    hd('Keyboard and touch'),
    item(
      'Search key',
      'The ChromeOS Launcher key is the Search key (where Caps Lock usually sits). The game never uses it or Alt, so ChromeOS shortcuts keep working; pressing Search lets go of every held key, so press your move keys again.',
    ),
    item('No numpad needed', 'Player 2 plays on the arrow keys with . (Fire), / (Dash) and , (Special).'),
    item(
      'Touchscreen',
      'Tap menus, the Patch Bay, Firmware, TERMINAL and this manual. Playing uses the keyboard.',
    ),
    hd('Tips'),
    item('Plug in', 'On battery ChromeOS slows the processor down. Play plugged in.'),
    item('Close other tabs', 'Other tabs and Android apps share the memory and the processor.'),
    item('Use Chrome', 'Play in the Chrome browser, not through an Android app.'),
    item('Fullscreen', 'Press the Fullscreen key on the top row (above 4) for the whole screen.'),
  ]);
}
