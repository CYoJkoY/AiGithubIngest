import { t } from '../core/i18n';
import { StorageSchema, SupportedLang } from '../types';
import { DEFAULT_FILE_SIZE_LIMIT, DEFAULT_SITE_FILE_SIZE_LIMITS } from '../core/constants';

const MB = 1024 * 1024;
const FALLBACK_KEY = '__default__';

interface SiteLimitRow {
  readonly host: string;
  readonly label: string;
}

const SITE_LIMIT_ROWS: readonly SiteLimitRow[] = [
  { host: 'chatgpt.com', label: 'ChatGPT' },
  { host: 'claude.ai', label: 'Claude' },
  { host: 'gemini.google.com', label: 'Gemini' },
  { host: 'chat.deepseek.com', label: 'DeepSeek' },
  { host: 'doubao.com', label: 'Doubao' },
  { host: 'qwen.ai', label: 'Qwen / Tongyi' },
  { host: 'yuanbao.tencent.com', label: 'Yuanbao' },
];

interface RowState {
  readonly host: string;
  readonly label: string;
  readonly currentBytes: number;
  readonly builtinBytes: number;
}

export function renderSiteLimits(
  storage: StorageSchema,
  currentLang: SupportedLang,
  onUpdate: () => Promise<void>,
): void {
  const container = document.getElementById('site-limits-list');
  if (!container) return;
  container.innerHTML = '';

  const userLimits = { ...(storage.siteFileSizeLimits ?? {}) };
  const defaultBytes = storage.defaultFileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT;

  const rows: RowState[] = SITE_LIMIT_ROWS.map((r) => ({
    host: r.host,
    label: r.label,
    currentBytes: userLimits[r.host] ?? DEFAULT_SITE_FILE_SIZE_LIMITS[r.host] ?? defaultBytes,
    builtinBytes: DEFAULT_SITE_FILE_SIZE_LIMITS[r.host] ?? defaultBytes,
  }));

  rows.push({
    host: FALLBACK_KEY,
    label: t('siteLimitOtherLabel', currentLang),
    currentBytes: defaultBytes,
    builtinBytes: DEFAULT_FILE_SIZE_LIMIT,
  });

  for (const row of rows) {
    container.appendChild(buildRow(row, userLimits, currentLang, onUpdate));
  }
}

function buildRow(
  state: RowState,
  userLimits: Record<string, number>,
  currentLang: SupportedLang,
  onUpdate: () => Promise<void>,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'site-limit-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'site-limit-label';
  labelEl.textContent = state.label;
  labelEl.title = state.label;
  row.appendChild(labelEl);

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.step = '1';
  input.className = 'input-text site-limit-input';
  input.value = String(Math.max(1, Math.round(state.currentBytes / MB)));
  row.appendChild(input);

  const unit = document.createElement('span');
  unit.className = 'site-limit-unit';
  unit.textContent = 'MB';
  row.appendChild(unit);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn btn-secondary btn-inline site-limit-reset';
  resetBtn.textContent = t('siteFileLimitReset', currentLang);
  row.appendChild(resetBtn);

  input.addEventListener('change', () => {
    void persistLimit(state, input, userLimits, onUpdate);
  });

  resetBtn.addEventListener('click', () => {
    void resetLimit(state, userLimits, onUpdate);
  });

  return row;
}

async function persistLimit(
  state: RowState,
  input: HTMLInputElement,
  userLimits: Record<string, number>,
  onUpdate: () => Promise<void>,
): Promise<void> {
  const parsed = Number.parseFloat(input.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    input.value = String(Math.max(1, Math.round(state.currentBytes / MB)));
    return;
  }
  const bytes = Math.round(parsed * MB);

  if (state.host === FALLBACK_KEY) {
    await chrome.storage.sync.set({ defaultFileSizeLimit: bytes });
  } else {
    const next = { ...userLimits, [state.host]: bytes };
    await chrome.storage.sync.set({ siteFileSizeLimits: next });
  }
  await onUpdate();
}

async function resetLimit(
  state: RowState,
  userLimits: Record<string, number>,
  onUpdate: () => Promise<void>,
): Promise<void> {
  if (state.host === FALLBACK_KEY) {
    await chrome.storage.sync.set({ defaultFileSizeLimit: DEFAULT_FILE_SIZE_LIMIT });
  } else {
    const next = { ...userLimits };
    delete next[state.host];
    await chrome.storage.sync.set({ siteFileSizeLimits: next });
  }
  await onUpdate();
}
