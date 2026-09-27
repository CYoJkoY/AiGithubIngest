import { StorageSchema, SupportedLang } from '../types';
import { normalizeHostname } from '../core/policy';

export class StorageService {
  public static async load(): Promise<StorageSchema> {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        [
          'userWhitelist',
          'userBlacklist',
          'githubToken',
          'lang',
          'siteFileSizeLimits',
          'defaultFileSizeLimit',
        ],
        (res) => resolve((res as StorageSchema) ?? {}),
      );
    });
  }

  public static async setLanguage(lang: SupportedLang): Promise<void> {
    await chrome.storage.sync.set({ lang });
  }

  public static async saveGitHubToken(githubToken: string): Promise<void> {
    await chrome.storage.sync.set({ githubToken });
  }

  public static async clearGitHubToken(): Promise<void> {
    await chrome.storage.sync.set({ githubToken: '' });
  }

  public static async addBlacklist(rawDomain: string): Promise<boolean> {
    const clean = normalizeHostname(rawDomain);
    if (!clean || clean.length < 3) return false;

    const storage = await this.load();
    const currentBlacklist = storage.userBlacklist ?? [];
    if (currentBlacklist.includes(clean)) return false;

    await chrome.storage.sync.set({
      userBlacklist: [...currentBlacklist, clean],
      userWhitelist: (storage.userWhitelist ?? []).filter((d) => d !== clean),
    });
    return true;
  }

  public static async removeBlacklist(domain: string): Promise<void> {
    const clean = normalizeHostname(domain);
    const storage = await this.load();
    const updated = (storage.userBlacklist ?? []).filter((d) => d !== clean);
    await chrome.storage.sync.set({ userBlacklist: updated });
  }

  public static async addWhitelist(rawDomain: string): Promise<boolean> {
    const clean = normalizeHostname(rawDomain);
    if (!clean || clean.length < 3) return false;

    const storage = await this.load();
    const currentWhitelist = storage.userWhitelist ?? [];
    if (currentWhitelist.includes(clean)) return false;

    await chrome.storage.sync.set({
      userWhitelist: [...currentWhitelist, clean],
      userBlacklist: (storage.userBlacklist ?? []).filter((d) => d !== clean),
    });
    return true;
  }

  public static async removeWhitelist(domain: string): Promise<void> {
    const clean = normalizeHostname(domain);
    const storage = await this.load();
    const updated = (storage.userWhitelist ?? []).filter((d) => d !== clean);
    await chrome.storage.sync.set({ userWhitelist: updated });
  }

  public static async saveSiteLimit(domain: string, limitBytes: number): Promise<void> {
    const clean = normalizeHostname(domain);
    if (!clean) return;
    const storage = await this.load();
    const next = { ...(storage.siteFileSizeLimits ?? {}), [clean]: limitBytes };
    await chrome.storage.sync.set({ siteFileSizeLimits: next });
  }

  public static async removeSiteLimit(domain: string): Promise<void> {
    const clean = normalizeHostname(domain);
    const storage = await this.load();
    const next = { ...(storage.siteFileSizeLimits ?? {}) };
    delete next[clean];
    await chrome.storage.sync.set({ siteFileSizeLimits: next });
  }

  public static async saveFallbackLimit(defaultFileSizeLimit: number): Promise<void> {
    await chrome.storage.sync.set({ defaultFileSizeLimit });
  }
}
