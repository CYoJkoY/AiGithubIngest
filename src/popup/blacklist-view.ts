import { t } from '../core/i18n';
import { SupportedLang } from '../types';
import { logger } from '../core/logger';
import { StorageService } from './storage-service';

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
      await StorageService.removeBlacklist(domain);
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

  const added = await StorageService.addBlacklist(targetDomain);
  if (added) {
    input.value = '';
    await onUpdate();
  }
}
