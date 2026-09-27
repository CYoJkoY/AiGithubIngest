import { evaluateSitePolicy, normalizeHostname } from '../core/policy';
import { t } from '../core/i18n';
import { StorageSchema, SupportedLang } from '../types';
import { logger } from '../core/logger';

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
    whitelist,
    blacklist,
    badgeEl,
    toggleBtn,
    blacklistCurrentBtn,
    currentLang,
    onUpdate,
    reloadTab,
  });
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
  whitelist: readonly string[];
  blacklist: readonly string[];
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
    whitelist,
    blacklist,
    badgeEl,
    toggleBtn,
    blacklistCurrentBtn,
    currentLang,
    onUpdate,
    reloadTab,
  } = args;

  if (policy === 'DISABLED_BLACKLIST') {
    badgeEl.textContent = t('blacklisted', currentLang);
    badgeEl.className = 'badge badge--blacklist';
    toggleBtn.textContent = t('removeFromBlacklistBtn', currentLang);
    toggleBtn.className = 'btn btn-primary';
    toggleBtn.onclick = async () => {
      await chrome.storage.sync.set({
        userBlacklist: blacklist.filter((d) => d !== cleanHost),
      });
      await onUpdate();
      await reloadTab();
    };
    blacklistCurrentBtn.classList.add('hidden');
    return;
  }

  if (policy === 'ENABLED_BUILTIN') {
    badgeEl.textContent = t('builtin', currentLang);
    badgeEl.className = 'badge badge--builtin';
    toggleBtn.textContent = t('disableBuiltinBtn', currentLang);
    toggleBtn.className = 'btn btn-secondary';
    toggleBtn.onclick = async () => {
      await chrome.storage.sync.set({ userBlacklist: [...blacklist, cleanHost] });
      await onUpdate();
      await reloadTab();
    };
    blacklistCurrentBtn.classList.add('hidden');
    return;
  }

  if (policy === 'ENABLED_WHITELIST') {
    badgeEl.textContent = t('whitelisted', currentLang);
    badgeEl.className = 'badge badge--whitelist';
    toggleBtn.textContent = t('removeWhitelist', currentLang);
    toggleBtn.className = 'btn btn-secondary';
    toggleBtn.onclick = async () => {
      await chrome.storage.sync.set({ userWhitelist: whitelist.filter((d) => d !== cleanHost) });
      await onUpdate();
      await reloadTab();
    };
    blacklistCurrentBtn.classList.remove('hidden');
    blacklistCurrentBtn.textContent = t('addToBlacklistBtn', currentLang);
    blacklistCurrentBtn.onclick = async () => {
      await chrome.storage.sync.set({
        userWhitelist: whitelist.filter((d) => d !== cleanHost),
        userBlacklist: [...blacklist, cleanHost],
      });
      await onUpdate();
      await reloadTab();
    };
    return;
  }

  badgeEl.textContent = t('disabled', currentLang);
  badgeEl.className = 'badge badge--disabled';
  toggleBtn.textContent = t('addWhitelist', currentLang);
  toggleBtn.className = 'btn btn-primary';
  toggleBtn.onclick = async () => {
    await chrome.storage.sync.set({ userWhitelist: [...whitelist, cleanHost] });
    await onUpdate();
    await reloadTab();
  };
  blacklistCurrentBtn.classList.remove('hidden');
  blacklistCurrentBtn.textContent = t('addToBlacklistBtn', currentLang);
  blacklistCurrentBtn.onclick = async () => {
    await chrome.storage.sync.set({ userBlacklist: [...blacklist, cleanHost] });
    await onUpdate();
    await reloadTab();
  };
}
