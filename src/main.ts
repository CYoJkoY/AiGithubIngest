import { ingestRepository } from './core/ingest';
import type { IngestSummary } from './types';

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
  ui.submitBtnText.textContent = loading ? '提取中...' : '开始提取';
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
  ui.resultStats.innerHTML = `已提取 <strong>${summary.files.length}</strong> 个文件 | 默认分支: <code>${summary.resolvedBranch}</code>`;
  ui.resultSection.classList.remove('hidden');
  ui.statusPanel.classList.add('hidden');
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return `提取失败: ${err.message}`;
  return '提取失败：遇到未知错误';
}

async function runIngest(ui: UiRefs): Promise<void> {
  const rawUrl = ui.repoUrlInput.value.trim();
  const token = ui.tokenInput.value.trim();

  if (!rawUrl) {
    showError(ui, '请先输入 GitHub 仓库地址。');
    ui.repoUrlInput.focus();
    return;
  }

  setLoading(ui, true, '初始化提取任务...');
  ui.resultSection.classList.add('hidden');

  try {
    const summary = await ingestRepository(rawUrl, {
      token: token || undefined,
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
    ui.copyBtn.textContent = '已复制到剪贴板！';
    setTimeout(() => {
      ui.copyBtn.textContent = originalText;
    }, 2000);
  } catch {
    ui.outputArea.select();
    document.execCommand('copy');
    ui.copyBtn.textContent = '已复制！';
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
