import { ingestRepository } from './core/ingest';
import { t } from './core/i18n';
import type { IngestSummary, SupportedLang } from './types';

interface UiRefs {
  readonly form: HTMLFormElement;
  readonly repoUrlInput: HTMLInputElement;
  readonly tokenInput: HTMLInputElement;
  readonly submitBtn: HTMLButtonElement;
  readonly submitBtnText: HTMLElement;
  readonly statusPanel: HTMLElement;
  readonly progressIndicator: HTMLElement;
  readonly progressText: HTMLElement;
  readonly errorBanner: HTMLElement;
  readonly resultSection: HTMLElement;
  readonly resultStats: HTMLElement;
  readonly outputArea: HTMLTextAreaElement;
  readonly copyBtn: HTMLButtonElement;
}

function resolveStandaloneLang(): SupportedLang {
  try {
    // 独立 Web UI 无 chrome.storage，通过 URL 参数或 localStorage 获取
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get('lang');
    if (urlLang === 'en' || urlLang === 'zh-CN') return urlLang;
    const stored = localStorage.getItem('aigi-lang');
    if (stored === 'en' || stored === 'zh-CN') return stored;
  } catch {
    /* fallback */
  }
  return navigator.language.startsWith('zh') ? 'zh-CN' : 'en';
}

const LANG = resolveStandaloneLang();

function collectUiRefs(): UiRefs {
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
  return {
    form: document.getElementById('ingest-form') as HTMLFormElement,
    repoUrlInput: document.getElementById('repo-url') as HTMLInputElement,
    tokenInput: document.getElementById('github-token') as HTMLInputElement,
    submitBtn,
    submitBtnText: submitBtn.querySelector('.btn-text') as HTMLElement,
    statusPanel: document.getElementById('status-panel') as HTMLElement,
    progressIndicator: document.getElementById('progress-indicator') as HTMLElement,
    progressText: document.getElementById('progress-text') as HTMLElement,
    errorBanner: document.getElementById('error-banner') as HTMLElement,
    resultSection: document.getElementById('result-section') as HTMLElement,
    resultStats: document.getElementById('result-stats') as HTMLElement,
    outputArea: document.getElementById('output-area') as HTMLTextAreaElement,
    copyBtn: document.getElementById('copy-btn') as HTMLButtonElement,
  };
}

function setLoading(ui: UiRefs, loading: boolean, text = ''): void {
  ui.submitBtn.disabled = loading;
  ui.submitBtnText.textContent = loading
    ? t('standaloneExtracting', LANG)
    : t('standaloneStartExtract', LANG);
  ui.statusPanel.classList.remove('hidden');
  if (loading) {
    ui.progressIndicator.classList.remove('hidden');
    ui.progressText.textContent = text;
    ui.errorBanner.classList.add('hidden');
    ui.errorBanner.textContent = '';
  } else {
    ui.progressIndicator.classList.add('hidden');
  }
}

function showError(ui: UiRefs, msg: string): void {
  ui.statusPanel.classList.remove('hidden');
  ui.progressIndicator.classList.add('hidden');
  ui.errorBanner.classList.remove('hidden');
  ui.errorBanner.textContent = msg;
}

function renderSummary(ui: UiRefs, summary: IngestSummary): void {
  ui.outputArea.value = summary.formattedOutput;
  ui.resultStats.innerHTML = t('standaloneResultStats', LANG, {
    count: String(summary.files.length),
    branch: summary.resolvedBranch,
  });
  ui.resultSection.classList.remove('hidden');
  ui.statusPanel.classList.add('hidden');
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return t('standaloneExtractFailed', LANG, { msg: err.message });
  }
  return t('standaloneUnknownError', LANG);
}

async function runIngest(ui: UiRefs): Promise<void> {
  const rawUrl = ui.repoUrlInput.value.trim();
  const token = ui.tokenInput.value.trim();
  if (!rawUrl) {
    showError(ui, t('standaloneUrlRequired', LANG));
    ui.repoUrlInput.focus();
    return;
  }
  setLoading(ui, true, t('standaloneInitializing', LANG));
  ui.resultSection.classList.add('hidden');
  try {
    const summary = await ingestRepository(rawUrl, {
      token: token || undefined,
      lang: LANG,
      onProgress: (status: string) => {
        ui.progressText.textContent = status;
      },
    });
    renderSummary(ui, summary);
  } catch (err: unknown) {
    showError(ui, formatErrorMessage(err));
  } finally {
    setLoading(ui, false);
  }
}

async function runCopy(ui: UiRefs): Promise<void> {
  if (!ui.outputArea.value) return;
  try {
    await navigator.clipboard.writeText(ui.outputArea.value);
    const originalText = ui.copyBtn.textContent;
    ui.copyBtn.textContent = t('standaloneCopied', LANG);
    setTimeout(() => {
      ui.copyBtn.textContent = originalText;
    }, 2000);
  } catch {
    ui.outputArea.select();
    document.execCommand('copy');
    ui.copyBtn.textContent = t('standaloneCopiedFallback', LANG);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const ui = collectUiRefs();

  ui.form.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    void runIngest(ui);
  });

  ui.copyBtn.addEventListener('click', () => {
    void runCopy(ui);
  });
});
