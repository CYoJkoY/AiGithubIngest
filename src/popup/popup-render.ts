import { t } from '../core/i18n';
import { StorageSchema, SupportedLang } from '../types';
import { renderBlacklistTags } from './blacklist-view';
import { renderSitePolicy } from './site-policy-view';

export async function getStorage(): Promise<StorageSchema> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['userWhitelist', 'userBlacklist', 'githubToken', 'lang'], (res) =>
      resolve(res as StorageSchema),
    );
  });
}

export async function render(): Promise<void> {
  const storage = await getStorage();
  const currentLang: SupportedLang = storage.lang || 'zh-CN';
  const blacklist = storage.userBlacklist ?? [];

  const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
  langSelect.value = currentLang;

  document.getElementById('lbl-language')!.textContent = t('language', currentLang);
  const githubLink = document.getElementById('github-link') as HTMLAnchorElement | null;
  if (githubLink) {
    const label = t('openGithubRepo', currentLang);
    githubLink.setAttribute('aria-label', label);
    githubLink.setAttribute('title', label);
  }
  document.getElementById('lbl-title')!.textContent = t('popupTitle', currentLang);
  document.getElementById('lbl-blacklist-title')!.textContent = t(
    'blacklistSectionTitle',
    currentLang,
  );
  document.getElementById('add-blacklist-btn')!.textContent = t('addBlacklistBtn', currentLang);
  (document.getElementById('blacklist-input') as HTMLInputElement).placeholder = t(
    'blacklistInputPlaceholder',
    currentLang,
  );
  document.getElementById('lbl-token-title')!.textContent = t('tokenSectionTitle', currentLang);
  document.getElementById('lbl-token-hint')!.textContent = t('tokenHint', currentLang);
  document.getElementById('save-token-btn')!.textContent = t('tokenSave', currentLang);
  document.getElementById('clear-token-btn')!.textContent = t('tokenClear', currentLang);

  const tokenInput = document.getElementById('token-input') as HTMLInputElement;
  tokenInput.placeholder = t('tokenPlaceholder', currentLang);
  if (storage.githubToken && !tokenInput.dataset.dirty) {
    tokenInput.value = storage.githubToken;
  }

  renderBlacklistTags(blacklist, currentLang, render);
  await renderSitePolicy(storage, currentLang, render);
}
