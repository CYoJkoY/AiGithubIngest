import { t, I18nKey } from '../core/i18n';
import { StorageSchema, SupportedLang, ThemeMode } from '../types';
import { renderBlacklistTags } from './blacklist-view';
import { renderSendMode } from './send-mode-view';
import { renderSitePolicy } from './site-policy-view';
import { renderSiteLimits } from './site-limits-view';
import { StorageService } from './storage-service';
import { datasetKey, querySwitchOptions } from './segmented-switch';

export async function getStorage(): Promise<StorageSchema> {
  return StorageService.load();
}

interface TextBinding {
  readonly id: string;
  readonly key: I18nKey;
}

const TEXT_BINDINGS: readonly TextBinding[] = [
  { id: 'lbl-title', key: 'popupTitle' },
  { id: 'lbl-send-mode-title', key: 'sendModeTitle' },
  { id: 'lbl-blacklist-title', key: 'blacklistSectionTitle' },
  { id: 'add-blacklist-btn', key: 'addBlacklistBtn' },
  { id: 'lbl-token-title', key: 'tokenSectionTitle' },
  { id: 'lbl-token-hint', key: 'tokenHint' },
  { id: 'save-token-btn', key: 'tokenSave' },
  { id: 'clear-token-btn', key: 'tokenClear' },
  { id: 'lbl-site-limits-title', key: 'siteFileLimitTitle' },
  { id: 'lbl-site-limits-hint', key: 'siteFileLimitHint' },
];

function updateStaticTexts(lang: SupportedLang): void {
  for (const item of TEXT_BINDINGS) {
    const el = document.getElementById(item.id);
    if (el) {
      el.textContent = t(item.key, lang);
    }
  }
}

/** Paint the two masthead switches from the resolved locale/spectrum. */
function syncSegmentedSwitch(wrapperId: string, attribute: string, activeValue: string): void {
  const wrapper = document.getElementById(wrapperId);
  if (!wrapper) return;

  for (const option of querySwitchOptions(wrapper, attribute)) {
    const selected = option.dataset[datasetKey(attribute)] === activeValue;
    option.setAttribute('aria-pressed', String(selected));
  }
}

function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
}

function updateTopBar(storage: StorageSchema, lang: SupportedLang): void {
  const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolvedTheme: ThemeMode = storage.theme ?? (isSystemDark ? 'dark' : 'light');

  applyTheme(resolvedTheme);
  syncSegmentedSwitch('lang-switch-wrapper', 'lang', lang);
  syncSegmentedSwitch('theme-switch-wrapper', 'theme-value', resolvedTheme);

  const githubLink = document.getElementById('github-link') as HTMLAnchorElement | null;
  if (githubLink) {
    const label = t('openGithubRepo', lang);
    githubLink.setAttribute('aria-label', label);
    githubLink.setAttribute('title', label);
  }

  const langWrapper = document.getElementById('lang-switch-wrapper');
  if (langWrapper) langWrapper.title = t('popupLangSwitchTitle', lang);

  const themeWrapper = document.getElementById('theme-switch-wrapper');
  if (themeWrapper) themeWrapper.title = t('popupThemeSwitchTitle', lang);
}

function updateInputs(storage: StorageSchema, lang: SupportedLang): void {
  const blacklistInput = document.getElementById('blacklist-input') as HTMLInputElement | null;
  if (blacklistInput) {
    blacklistInput.placeholder = t('blacklistInputPlaceholder', lang);
  }

  const tokenInput = document.getElementById('token-input') as HTMLInputElement | null;
  if (tokenInput) {
    tokenInput.placeholder = t('tokenPlaceholder', lang);
    if (Boolean(storage.githubToken) && !tokenInput.dataset.dirty) {
      tokenInput.value = storage.githubToken ?? '';
    }
  }

  updateTokenState(storage, lang);
}

/** The PAT section states its own status — a trust boundary, not a form field. */
function updateTokenState(storage: StorageSchema, lang: SupportedLang): void {
  const chip = document.getElementById('token-state-chip');
  const text = document.getElementById('token-state-text');
  const configured = Boolean(storage.githubToken);
  if (text) {
    text.textContent = configured ? t('tokenStateSet', lang) : t('tokenStateEmpty', lang);
  }
  if (chip) {
    chip.setAttribute('data-state', configured ? 'set' : 'empty');
    chip.className = configured ? 'wabi-chip wabi-chip--moss' : 'wabi-chip';
  }
}

function updateColophon(): void {
  const el = document.getElementById('colophon-version');
  if (!el) return;
  try {
    el.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch {
    el.textContent = '';
  }
}

export async function render(): Promise<void> {
  const storage = await getStorage();
  const currentLang: SupportedLang = storage.lang || 'zh-CN';
  const blacklist = storage.userBlacklist ?? [];

  updateTopBar(storage, currentLang);
  updateStaticTexts(currentLang);
  updateInputs(storage, currentLang);
  updateColophon();

  renderSendMode(storage, currentLang, render);
  renderBlacklistTags(blacklist, currentLang, render);
  await renderSiteLimits(storage, currentLang, render);
  await renderSitePolicy(storage, currentLang, render);
}
