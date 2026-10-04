// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageSchema } from '../types';
import { datasetKey, querySwitchOptions, setupSegmentedSwitch } from './segmented-switch';
import { renderSendMode } from './send-mode-view';

const SECTION_HTML = `
  <div class="wabi-segmented wabi-segmented--block" id="send-mode-switch" role="radiogroup">
    <button type="button" id="send-mode-real" data-send-mode="real-file" role="radio"></button>
    <button type="button" id="send-mode-pseudo" data-send-mode="pseudo-file" role="radio"></button>
  </div>
  <p id="lbl-send-mode-hint"></p>
  <dl id="send-mode-facts"></dl>
`;

/**
 * The view binds its click handlers once per module, so the DOM is created a
 * single time for the whole suite and only re-rendered between cases.
 */
let written: Record<string, unknown> = {};

beforeAll(() => {
  document.body.innerHTML = SECTION_HTML;

  let store: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: (_keys: string[], cb: (res: Record<string, unknown>) => void) => cb({ ...store }),
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          store = { ...store, ...obj };
          written = { ...written, ...obj };
          cb?.();
        },
      },
    },
  });
});

beforeEach(() => {
  written = {};
  document.getElementById('send-mode-facts')!.textContent = '';
});

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const click = (id: string): void => {
  el(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('segmented switch helpers', () => {
  it('converts kebab-case attributes to dataset keys', () => {
    expect(datasetKey('lang')).toBe('lang');
    expect(datasetKey('theme-value')).toBe('themeValue');
    expect(datasetKey('send-mode')).toBe('sendMode');
  });

  it('finds options by kebab-case attribute', () => {
    const wrapper = el('send-mode-switch');
    expect(querySwitchOptions(wrapper, 'send-mode')).toHaveLength(2);
  });

  it('invokes the callback with the picked value', () => {
    const onPick = vi.fn(async () => undefined);
    setupSegmentedSwitch('send-mode-switch', 'send-mode', onPick);

    click('send-mode-pseudo');

    expect(onPick).toHaveBeenCalledWith('pseudo-file');
  });
});

describe('send-mode view', () => {
  it('defaults to the real-file mode when storage is silent', () => {
    renderSendMode({}, 'zh-CN', async () => undefined);

    expect(el('send-mode-real').getAttribute('aria-checked')).toBe('true');
    expect(el('send-mode-pseudo').getAttribute('aria-checked')).toBe('false');
    expect(el('send-mode-facts').textContent).toContain('站点附件 (.md)');
  });

  it('renders the stored pseudo-file selection', () => {
    const storage: StorageSchema = { digestSendMode: 'pseudo-file' };
    renderSendMode(storage, 'zh-CN', async () => undefined);

    expect(el('send-mode-pseudo').getAttribute('aria-checked')).toBe('true');
    expect(el('send-mode-real').getAttribute('aria-checked')).toBe('false');
    expect(el('send-mode-facts').textContent).toContain('纯文本消息');
    expect(el('lbl-send-mode-hint').textContent).toContain('不受上传限制影响');
  });

  it('localises labels, hint, and facts', () => {
    renderSendMode({ digestSendMode: 'pseudo-file' }, 'en', async () => undefined);

    expect(el('send-mode-real').textContent).toBe('Real .md file');
    expect(el('send-mode-pseudo').textContent).toBe('Pseudo-file (text)');
    expect(el('lbl-send-mode-hint').textContent).toContain('Choose how a repository digest');
    expect(el('send-mode-facts').textContent).toBe(
      'Active modePseudo-file (text)Delivered asPlain text messageOn failureFalls back to real file',
    );
  });

  it('states the failure behaviour so it is known before it happens', () => {
    renderSendMode({}, 'zh-CN', async () => undefined);
    const facts = el('send-mode-facts').textContent ?? '';
    expect(facts).toContain('失败回退');
    expect(facts).toContain('自动改用真文件');
  });

  it('always renders three fact rows', () => {
    renderSendMode({}, 'zh-CN', async () => undefined);
    expect(el('send-mode-facts').querySelectorAll('.wabi-meta-field')).toHaveLength(3);
  });

  it('persists the picked mode, refreshes, and re-renders from storage', async () => {
    const onUpdate = vi.fn(async () => undefined);
    renderSendMode({ digestSendMode: 'real-file' }, 'zh-CN', onUpdate);
    expect(el('send-mode-real').getAttribute('aria-checked')).toBe('true');

    click('send-mode-pseudo');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 1. the choice reached storage through StorageService
    expect(written.digestSendMode).toBe('pseudo-file');
    // 2. the view asked its owner to repaint
    expect(onUpdate).toHaveBeenCalledTimes(1);
    // 3. a repaint driven by that storage now shows the new selection
    renderSendMode({ digestSendMode: 'pseudo-file' }, 'zh-CN', onUpdate);
    expect(el('send-mode-pseudo').getAttribute('aria-checked')).toBe('true');
    expect(el('send-mode-real').getAttribute('aria-checked')).toBe('false');
  });
});
