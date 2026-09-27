import { StorageSchema, SupportedLang } from '../types';

export let cachedWhitelist: readonly string[] = [];
export let cachedBlacklist: readonly string[] = [];
export let cachedLang: SupportedLang = 'zh-CN';

export async function refreshStorageConfig(): Promise<void> {
  const storageData = await new Promise<StorageSchema>((resolve) => {
    try {
      chrome.storage.sync.get(['userWhitelist', 'userBlacklist', 'lang'], (res) => {
        resolve((res as StorageSchema) ?? {});
      });
    } catch {
      resolve({});
    }
  });
  cachedWhitelist = storageData.userWhitelist ?? [];
  cachedBlacklist = storageData.userBlacklist ?? [];
  cachedLang = storageData.lang || 'zh-CN';
}

export function setupStorageListener(): void {
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync') {
        if (changes.userWhitelist) {
          cachedWhitelist = changes.userWhitelist.newValue ?? [];
        }
        if (changes.userBlacklist) {
          cachedBlacklist = changes.userBlacklist.newValue ?? [];
        }
        if (changes.lang) {
          cachedLang = changes.lang.newValue || 'zh-CN';
        }
      }
    });
  } catch (err) {
    console.warn('[AiGithubIngest] storage.onChanged listener failed:', err);
  }
}
