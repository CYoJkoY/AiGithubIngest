import { StorageSchema, SupportedLang } from '../types';
import { logger } from '../core/logger';
import { DEFAULT_FILE_SIZE_LIMIT } from '../core/constants';

export let cachedWhitelist: readonly string[] = [];
export let cachedBlacklist: readonly string[] = [];
export let cachedLang: SupportedLang = 'zh-CN';
export let cachedSiteFileSizeLimits: Readonly<Record<string, number>> | undefined = undefined;
export let cachedDefaultFileSizeLimit: number = DEFAULT_FILE_SIZE_LIMIT;

export async function refreshStorageConfig(): Promise<void> {
  const storageData = await new Promise<StorageSchema>((resolve) => {
    try {
      chrome.storage.sync.get(
        ['userWhitelist', 'userBlacklist', 'lang', 'siteFileSizeLimits', 'defaultFileSizeLimit'],
        (res) => {
          resolve((res as StorageSchema) ?? {});
        },
      );
    } catch (err) {
      logger.warn('storage.sync.get failed', err);
      resolve({});
    }
  });
  cachedWhitelist = storageData.userWhitelist ?? [];
  cachedBlacklist = storageData.userBlacklist ?? [];
  cachedLang = storageData.lang || 'zh-CN';
  cachedSiteFileSizeLimits = storageData.siteFileSizeLimits;
  cachedDefaultFileSizeLimit = storageData.defaultFileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT;
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
      if (changes.siteFileSizeLimits) {
        cachedSiteFileSizeLimits = changes.siteFileSizeLimits.newValue ?? undefined;
      }
      if (changes.defaultFileSizeLimit) {
        cachedDefaultFileSizeLimit =
          changes.defaultFileSizeLimit.newValue ?? DEFAULT_FILE_SIZE_LIMIT;
      }
    });
    listenerInstalled = true;
  } catch (err) {
    logger.warn('storage.onChanged listener failed', err);
  }
}
