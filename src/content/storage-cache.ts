import { StorageSchema, SupportedLang, ThemeMode, DigestSendMode } from '../types';
import { logger } from '../core/logger';
import { DEFAULT_FILE_SIZE_LIMIT, DEFAULT_DIGEST_SEND_MODE } from '../core/constants';

export let cachedWhitelist: readonly string[] = [];
export let cachedBlacklist: readonly string[] = [];
export let cachedLang: SupportedLang = 'zh-CN';
export let cachedTheme: ThemeMode = 'light';
export let cachedDigestSendMode: DigestSendMode = DEFAULT_DIGEST_SEND_MODE;
export let cachedSiteFileSizeLimits: Readonly<Record<string, number>> | undefined = undefined;
export let cachedDefaultFileSizeLimit: number = DEFAULT_FILE_SIZE_LIMIT;

const CACHED_KEYS: readonly (keyof StorageSchema)[] = [
  'userWhitelist',
  'userBlacklist',
  'lang',
  'theme',
  'digestSendMode',
  'siteFileSizeLimits',
  'defaultFileSizeLimit',
];

export async function refreshStorageConfig(): Promise<void> {
  const storageData = await new Promise<StorageSchema>((resolve) => {
    try {
      chrome.storage.sync.get(CACHED_KEYS as string[], (res) => {
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
  cachedTheme = storageData.theme === 'dark' ? 'dark' : 'light';
  cachedDigestSendMode = storageData.digestSendMode ?? DEFAULT_DIGEST_SEND_MODE;
  cachedSiteFileSizeLimits = storageData.siteFileSizeLimits;
  cachedDefaultFileSizeLimit = storageData.defaultFileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT;
}

let listenerInstalled = false;

/**
 * Per-key appliers for live storage changes.
 *
 * A dispatch table keeps the `onChanged` listener flat instead of growing an
 * if-chain every time a new setting is cached.
 */
const APPLIERS: Readonly<Record<string, (value: unknown) => void>> = {
  userWhitelist: (value) => {
    cachedWhitelist = (value as readonly string[] | undefined) ?? [];
  },
  userBlacklist: (value) => {
    cachedBlacklist = (value as readonly string[] | undefined) ?? [];
  },
  lang: (value) => {
    cachedLang = (value as SupportedLang | undefined) || 'zh-CN';
  },
  theme: (value) => {
    cachedTheme = value === 'dark' ? 'dark' : 'light';
  },
  digestSendMode: (value) => {
    cachedDigestSendMode = (value as DigestSendMode | undefined) ?? DEFAULT_DIGEST_SEND_MODE;
  },
  siteFileSizeLimits: (value) => {
    cachedSiteFileSizeLimits = value as Readonly<Record<string, number>> | undefined;
  },
  defaultFileSizeLimit: (value) => {
    cachedDefaultFileSizeLimit = (value as number | undefined) ?? DEFAULT_FILE_SIZE_LIMIT;
  },
};

export function setupStorageListener(): void {
  if (listenerInstalled) return;
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      for (const key of Object.keys(changes)) {
        APPLIERS[key]?.(changes[key]?.newValue);
      }
    });
    listenerInstalled = true;
  } catch (err) {
    logger.warn('storage.onChanged listener failed', err);
  }
}
