import { t } from '../core/i18n';
import { StorageSchema, SupportedLang } from '../types';
import { normalizeHostname } from '../core/policy';
import { logger } from '../core/logger';

export function renderBlacklistTags(
  blacklist: readonly string[],
  currentLang: SupportedLang,
  onUpdate: () => Promise<void>,
): void {
  const container = document.getElementById('blacklist-tags')!;
  container.innerHTML = '';

  if (blacklist.length === 0) {
    const tip = document.createElement('div');
    tip.className = 'empty-tip';
    tip.textContent = t('noBlacklistDomains', currentLang);
    container.appendChild(tip);
    return;
  }

  for (const domain of blacklist) {
    const tag = document.createElement('span');
    tag.className = 'blacklist-tag';
    const text = document.createElement('span');
    text.textContent = domain;
    tag.appendChild(text);

    const delBtn = document.createElement('button');
    delBtn.className = 'tag-remove-btn';
    delBtn.textContent = '×';
    delBtn.title = t('removeFromBlacklistBtn', currentLang);
    delBtn.onclick = async () => {
      const updated = blacklist.filter((d) => d !== domain);
      await chrome.storage.sync.set({ userBlacklist: updated });
      await onUpdate();
    };
    tag.appendChild(delBtn);
    container.appendChild(tag);
  }
}

export async function handleAddBlacklist(
  input: HTMLInputElement,
  onUpdate: () => Promise<void>,
): Promise<void> {
  const rawVal = input.value.trim();
  if (!rawVal) return;

  let targetDomain = rawVal;
  try {
    if (targetDomain.includes('://')) targetDomain = new URL(targetDomain).hostname;
  } catch (err) {
    logger.debug('handleAddBlacklist: URL parse fallback', err);
  }

  const clean = normalizeHostname(targetDomain);
  if (!clean || clean.length < 3) return;

  const storage = await new Promise<StorageSchema>((resolve) => {
    chrome.storage.sync.get(['userWhitelist', 'userBlacklist'], (res) =>
      resolve(res as StorageSchema),
    );
  });

  const currentBlacklist = storage.userBlacklist ?? [];
  if (!currentBlacklist.includes(clean)) {
    await chrome.storage.sync.set({
      userBlacklist: [...currentBlacklist, clean],
      userWhitelist: (storage.userWhitelist ?? []).filter((d) => d !== clean),
    });
  }

  input.value = '';
  await onUpdate();
}
