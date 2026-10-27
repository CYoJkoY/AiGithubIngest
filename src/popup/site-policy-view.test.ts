// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageSchema } from '../types';
import { renderSitePolicy } from './site-policy-view';

const SECTION_HTML = `
  <span id="current-domain">--</span>
  <span id="site-badge" class="wabi-chip"><span class="badge-text">Checking...</span></span>
  <button id="toggle-btn" disabled></button>
  <button id="blacklist-current-btn" class="hidden"></button>
`;

type TabStub = { readonly id?: number; readonly url?: string };

const EMPTY_STORAGE: StorageSchema = {};

let tabsResult: TabStub[] = [];
const reloadSpy = vi.fn();

const noopUpdate = async (): Promise<void> => undefined;

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const badgeText = (): string => el('site-badge').textContent ?? '';

beforeAll(() => {
  document.body.innerHTML = SECTION_HTML;

  vi.stubGlobal('chrome', {
    tabs: {
      query: async () => tabsResult,
      reload: reloadSpy,
    },
    storage: {
      sync: {
        get: (_keys: string[], cb: (res: Record<string, unknown>) => void) => cb({}),
        set: (_obj: Record<string, unknown>, cb?: () => void) => cb?.(),
      },
    },
  });
});

beforeEach(() => {
  document.body.innerHTML = SECTION_HTML;
  tabsResult = [];
  reloadSpy.mockClear();
});

describe('site policy view', () => {
  it('renders the active tab hostname and its built-in policy', async () => {
    tabsResult = [{ id: 7, url: 'https://chatgpt.com/c/abc' }];

    await renderSitePolicy(EMPTY_STORAGE, 'zh-CN', noopUpdate);

    expect(el('current-domain').textContent).toBe('chatgpt.com');
    expect(badgeText()).toBe('内置支持');
    expect((el('toggle-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('strips www and applies the user whitelist', async () => {
    tabsResult = [{ id: 7, url: 'https://www.example.com/chat' }];
    const storage: StorageSchema = { userWhitelist: ['example.com'] };

    await renderSitePolicy(storage, 'en', noopUpdate);

    expect(el('current-domain').textContent).toBe('example.com');
    expect(badgeText()).toBe('Whitelisted');
    expect(el('blacklist-current-btn').classList.contains('hidden')).toBe(false);
  });

  it('reports an unresolvable site when the tab exposes no URL', async () => {
    tabsResult = [{ id: 7 }];

    await renderSitePolicy(EMPTY_STORAGE, 'zh-CN', noopUpdate);

    expect(el('current-domain').textContent).toBe('无法获取当前站点');
    expect((el('toggle-btn') as HTMLButtonElement).disabled).toBe(true);
    expect(el('blacklist-current-btn').classList.contains('hidden')).toBe(true);
  });

  it('reports an unresolvable site when the tab query rejects', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: async () => {
          throw new Error('tabs unavailable');
        },
        reload: reloadSpy,
      },
    });

    await renderSitePolicy(EMPTY_STORAGE, 'en', noopUpdate);

    expect(el('current-domain').textContent).toBe('Cannot resolve site');
    expect((el('toggle-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});
