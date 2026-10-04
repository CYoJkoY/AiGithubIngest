import { SupportedLang, ThemeMode } from '../types';
import { render, getStorage } from './popup-render';
import { handleAddBlacklist } from './blacklist-view';
import { setupTokenView } from './token-view';
import { StorageService } from './storage-service';
import { setupSegmentedSwitch } from './segmented-switch';

document.addEventListener('DOMContentLoaded', () => {
  const blacklistInput = document.getElementById('blacklist-input') as HTMLInputElement;
  const addBlacklistBtn = document.getElementById('add-blacklist-btn') as HTMLButtonElement;

  setupSegmentedSwitch('lang-switch-wrapper', 'lang', async (value) => {
    const newLang: SupportedLang = value === 'en' ? 'en' : 'zh-CN';
    await StorageService.setLanguage(newLang);
    await render();
  });

  setupSegmentedSwitch('theme-switch-wrapper', 'theme-value', async (value) => {
    const newTheme: ThemeMode = value === 'dark' ? 'dark' : 'light';
    // Apply optimistically so the sheet never flashes the old spectrum.
    document.documentElement.dataset.theme = newTheme;
    await StorageService.setTheme(newTheme);
    await render();
  });

  addBlacklistBtn.addEventListener('click', () => {
    void handleAddBlacklist(blacklistInput, render);
  });

  blacklistInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleAddBlacklist(blacklistInput, render);
    }
  });

  setupTokenView(getStorage, render);

  void render();
});
