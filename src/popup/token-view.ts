import { t } from '../core/i18n';
import { StorageSchema, SupportedLang } from '../types';
import { StorageService } from './storage-service';

export function setupTokenView(
  getStorage: () => Promise<StorageSchema>,
  render: () => Promise<void>,
): void {
  const tokenInput = document.getElementById('token-input') as HTMLInputElement;
  const toggleVisibilityBtn = document.getElementById(
    'toggle-token-visibility',
  ) as HTMLButtonElement;
  const saveTokenBtn = document.getElementById('save-token-btn') as HTMLButtonElement;
  const clearTokenBtn = document.getElementById('clear-token-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('token-status') as HTMLDivElement;

  tokenInput.addEventListener('input', () => {
    tokenInput.dataset.dirty = 'true';
  });

  toggleVisibilityBtn.addEventListener('click', () => {
    tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
  });

  saveTokenBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    await StorageService.saveGitHubToken(token);
    tokenInput.dataset.dirty = '';
    const storage = await getStorage();
    const currentLang: SupportedLang = storage.lang || 'zh-CN';
    statusEl.textContent = t('tokenSaved', currentLang);
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2500);
    await render();
  });

  clearTokenBtn.addEventListener('click', async () => {
    tokenInput.value = '';
    tokenInput.dataset.dirty = '';
    await StorageService.clearGitHubToken();
    const storage = await getStorage();
    const currentLang: SupportedLang = storage.lang || 'zh-CN';
    statusEl.textContent = t('tokenCleared', currentLang);
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2500);
    await render();
  });
}
