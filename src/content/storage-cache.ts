import { StorageSchema, SupportedLang } from '../types';
import { logger } from '../core/logger';

export let cachedWhitelist: readonly string[] = [];
export let cachedBlacklist: readonly string[] = [];
export let cachedLang: SupportedLang = 'zh-CN';

export async function refreshStorageConfig(): Promise<void> {
  const storageData = await new Promise<StorageSchema>((resolve) => {
    try {
      chrome.storage.sync.get(['userWhitelist', 'userBlacklist', 'lang'], (res) => {
        resolve((res as StorageSchema) ?? {});
      });
    } catch (err) {
      logger.warn('storage.sync.get failed', err);
      resolve({});
    }
  });
  cachedWhitelist = storageData.userWhitelist ?? [];
  cachedBlacklist = storageData.userBlacklist ?? [];
  cachedLang = storageData.lang || 'zh-CN';
}

let listenerInstalled = false;

export function setupStorageListener(): void {
  if (listenerInstalled) return;
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (changes.userWhitelist) cachedWhitelist = changes.userWhitelist.newValue ?? [];
      if (changes.userBlacklist) cachedBlacklist = changes.userBlacklist.newValue ?? [];
      if (changes.lang) cachedLang = changes.lang.newValue || 'zh-CN';
    });
    listenerInstalled = true;
  } catch (err) {
    logger.warn('storage.onChanged listener failed', err);
  }
}
