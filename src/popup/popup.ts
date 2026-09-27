import { SupportedLang } from '../types';
import { render, getStorage } from './popup-render';
import { handleAddBlacklist } from './blacklist-view';
import { setupTokenView } from './token-view';

document.addEventListener('DOMContentLoaded', () => {
  const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
  const blacklistInput = document.getElementById('blacklist-input') as HTMLInputElement;
  const addBlacklistBtn = document.getElementById('add-blacklist-btn') as HTMLButtonElement;

  langSelect.addEventListener('change', async () => {
    const newLang = langSelect.value as SupportedLang;
    await chrome.storage.sync.set({ lang: newLang });
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
