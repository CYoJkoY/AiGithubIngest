import { BUILTIN_AI_DOMAINS, evaluateSitePolicy, matchDomain, normalizeHostname } from '../core/policy';
import { t } from '../core/i18n';
import { StorageSchema, SupportedLang } from '../types';
import { logger } from '../core/logger';
import { StorageService } from './storage-service';

export async function renderSitePolicy(
  storage: StorageSchema,
  currentLang: SupportedLang,
  onUpdate: () => Promise<void>,
): Promise<void> {
  const domainEl = document.getElementById('current-domain')!;
  const badgeEl = document.getElementById('site-badge')!;
  const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
  const blacklistCurrentBtn = document.getElementById('blacklist-current-btn') as HTMLButtonElement;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    showCantGetDomain(domainEl, toggleBtn, blacklistCurrentBtn, currentLang);
    return;
  }

  let hostname: string;
  try {
    hostname = new URL(tab.url).hostname;
  } catch (err) {
    logger.debug('renderSitePolicy: invalid tab URL', err);
    showCantGetDomain(domainEl, toggleBtn, blacklistCurrentBtn, currentLang);
    return;
  }

  const cleanHost = normalizeHostname(hostname);
  domainEl.textContent = cleanHost;

  const isSupportedSite = BUILTIN_AI_DOMAINS.some((domain) => matchDomain(cleanHost, domain));
  if (!isSupportedSite) {
    showUnsupportedSite(domainEl, badgeEl, toggleBtn, blacklistCurrentBtn, currentLang);
    return;
  }

  const whitelist = storage.userWhitelist ?? [];
  const blacklist = storage.userBlacklist ?? [];
  const policy = evaluateSitePolicy(cleanHost, whitelist, blacklist);
  toggleBtn.disabled = false;

  const reloadTab = async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) chrome.tabs.reload(activeTab.id);
  };

  applyPolicyUi({
    policy,
    cleanHost,
    badgeEl,
    toggleBtn,
    blacklistCurrentBtn,
    currentLang,
    onUpdate,
    reloadTab,
  });
}

function updateBadgeContent(badgeEl: HTMLElement, text: string, variantClass: string): void {
  badgeEl.className = `wabi-chip ${variantClass}`;
  const textEl = badgeEl.querySelector('.badge-text');
  if (textEl) {
    textEl.textContent = text;
  } else {
    badgeEl.textContent = text;
  }
}

function showUnsupportedSite(
  domainEl: HTMLElement,
  badgeEl: HTMLElement,
  toggleBtn: HTMLButtonElement,
  blacklistCurrentBtn: HTMLButtonElement,
  lang: SupportedLang,
): void {
  domainEl.textContent = domainEl.textContent || t('unsupportedSite', lang);
  updateBadgeContent(badgeEl, t('unsupportedSite', lang), 'wabi-chip--ink');
  toggleBtn.disabled = true;
  toggleBtn.textContent = t('unsupportedSite', lang);
  toggleBtn.className = 'wabi-button wabi-button--ghost btn-action';
  toggleBtn.onclick = null;
  blacklistCurrentBtn.classList.add('hidden');
}

function showCantGetDomain(
  domainEl: HTMLElement,
  toggleBtn: HTMLButtonElement,
  blacklistCurrentBtn: HTMLButtonElement,
  lang: SupportedLang,
): void {
  domainEl.textContent = t('cantGetDomain', lang);
  toggleBtn.disabled = true;
  blacklistCurrentBtn.classList.add('hidden');
}

interface PolicyUiArgs {
  policy: ReturnType<typeof evaluateSitePolicy>;
  cleanHost: string;
  badgeEl: HTMLElement;
  toggleBtn: HTMLButtonElement;
  blacklistCurrentBtn: HTMLButtonElement;
  currentLang: SupportedLang;
  onUpdate: () => Promise<void>;
  reloadTab: () => Promise<void>;
}

function applyPolicyUi(args: PolicyUiArgs): void {
  const {
    policy,
    cleanHost,
    badgeEl,
    toggleBtn,
    blacklistCurrentBtn,
    currentLang,
    onUpdate,
    reloadTab,
  } = args;

  if (policy === 'DISABLED_BLACKLIST') {
    updateBadgeContent(badgeEl, t('blacklisted', currentLang), 'wabi-chip--cinnabar');
    toggleBtn.textContent = t('removeFromBlacklistBtn', currentLang);
    toggleBtn.className = 'wabi-button wabi-button--primary btn-action';
    toggleBtn.onclick = async () => {
      await StorageService.removeBlacklist(cleanHost);
      await onUpdate();
      await reloadTab();
    };
    blacklistCurrentBtn.classList.add('hidden');
    return;
  }

  if (policy === 'ENABLED_BUILTIN') {
    updateBadgeContent(badgeEl, t('builtin', currentLang), 'wabi-chip--moss');
    toggleBtn.textContent = t('disableBuiltinBtn', currentLang);
    toggleBtn.className = 'wabi-button wabi-button--ghost btn-action';
    toggleBtn.onclick = async () => {
      await StorageService.addBlacklist(cleanHost);
      await onUpdate();
      await reloadTab();
    };
    blacklistCurrentBtn.classList.add('hidden');
    return;
  }

  if (policy === 'ENABLED_WHITELIST') {
    updateBadgeContent(badgeEl, t('whitelisted', currentLang), 'wabi-chip--moss');
    toggleBtn.textContent = t('removeWhitelist', currentLang);
    toggleBtn.className = 'wabi-button wabi-button--ghost btn-action';
    toggleBtn.onclick = async () => {
      await StorageService.removeWhitelist(cleanHost);
      await onUpdate();
      await reloadTab();
    };
    blacklistCurrentBtn.classList.remove('hidden');
    blacklistCurrentBtn.textContent = t('addToBlacklistBtn', currentLang);
    blacklistCurrentBtn.className = 'wabi-button wabi-button--danger btn-action';
    blacklistCurrentBtn.onclick = async () => {
      await StorageService.addBlacklist(cleanHost);
      await onUpdate();
      await reloadTab();
    };
    return;
  }

  updateBadgeContent(badgeEl, t('disabled', currentLang), 'wabi-chip--ink');
  toggleBtn.textContent = t('addWhitelist', currentLang);
  toggleBtn.className = 'wabi-button wabi-button--primary btn-action';
  toggleBtn.onclick = async () => {
    await StorageService.addWhitelist(cleanHost);
    await onUpdate();
    await reloadTab();
  };
  blacklistCurrentBtn.classList.remove('hidden');
  blacklistCurrentBtn.textContent = t('addToBlacklistBtn', currentLang);
  blacklistCurrentBtn.className = 'wabi-button wabi-button--danger btn-action';
  blacklistCurrentBtn.onclick = async () => {
    await StorageService.addBlacklist(cleanHost);
    await onUpdate();
    await reloadTab();
  };
}
