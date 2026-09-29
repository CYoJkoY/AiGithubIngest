import { SupportedLang, ThemeMode } from '../types';
import { render, getStorage } from './popup-render';
import { handleAddBlacklist } from './blacklist-view';
import { setupTokenView } from './token-view';
import { StorageService } from './storage-service';

document.addEventListener('DOMContentLoaded', () => {
  const langToggle = document.getElementById('lang-toggle') as HTMLInputElement;
  const themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;
  const blacklistInput = document.getElementById('blacklist-input') as HTMLInputElement;
  const addBlacklistBtn = document.getElementById('add-blacklist-btn') as HTMLButtonElement;

  // 左右滑块切换语言：未勾选 = zh-CN (左), 勾选 = en (右)
  langToggle.addEventListener('change', async () => {
    const newLang: SupportedLang = langToggle.checked ? 'en' : 'zh-CN';
    await StorageService.setLanguage(newLang);
    await render();
  });

  // 左右滑块切换主题：未勾选 = light 浅色 (左), 勾选 = dark 深色 (右)
  themeToggle.addEventListener('change', async () => {
    const newTheme: ThemeMode = themeToggle.checked ? 'dark' : 'light';
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
