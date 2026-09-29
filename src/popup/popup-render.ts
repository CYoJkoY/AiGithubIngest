import { t, I18nKey } from '../core/i18n';
import { StorageSchema, SupportedLang } from '../types';
import { renderBlacklistTags } from './blacklist-view';
import { renderSitePolicy } from './site-policy-view';
import { renderSiteLimits } from './site-limits-view';
import { StorageService } from './storage-service';

export async function getStorage(): Promise<StorageSchema> {
  return StorageService.load();
}

interface TextBinding {
  readonly id: string;
  readonly key: I18nKey;
}

const TEXT_BINDINGS: readonly TextBinding[] = [
  { id: 'lbl-title', key: 'popupTitle' },
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

function updateTopBar(lang: SupportedLang): void {
  const langSelect = document.getElementById('lang-select') as HTMLSelectElement | null;
  if (langSelect) {
    langSelect.value = lang;
  }

  const githubLink = document.getElementById('github-link') as HTMLAnchorElement | null;
  if (githubLink) {
    const label = t('openGithubRepo', lang);
    githubLink.setAttribute('aria-label', label);
    githubLink.setAttribute('title', label);
  }
}

function updateInputs(storage: StorageSchema, lang: SupportedLang): void {
  const blacklistInput = document.getElementById('blacklist-input') as HTMLInputElement | null;
  if (blacklistInput) {
    blacklistInput.placeholder = t('blacklistInputPlaceholder', lang);
  }

  const tokenInput = document.getElementById('token-input') as HTMLInputElement | null;
  if (!tokenInput) {
    return;
  }

  tokenInput.placeholder = t('tokenPlaceholder', lang);
  const shouldSyncToken = Boolean(storage.githubToken) && !tokenInput.dataset.dirty;
  if (shouldSyncToken) {
    tokenInput.value = storage.githubToken ?? '';
  }
}

export async function render(): Promise<void> {
  const storage = await getStorage();
  const currentLang: SupportedLang = storage.lang || 'zh-CN';
  const blacklist = storage.userBlacklist ?? [];

  updateTopBar(currentLang);
  updateStaticTexts(currentLang);
  updateInputs(storage, currentLang);

  renderBlacklistTags(blacklist, currentLang, render);
  await renderSiteLimits(storage, currentLang, render);
  await renderSitePolicy(storage, currentLang, render);
}
