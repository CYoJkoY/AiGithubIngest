import { ingestRepository } from './core/ingest';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('ingest-form') as HTMLFormElement;
  const repoUrlInput = document.getElementById('repo-url') as HTMLInputElement;
  const tokenInput = document.getElementById('github-token') as HTMLInputElement;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
  const submitBtnText = submitBtn.querySelector('.btn-text') as HTMLElement;

  const statusPanel = document.getElementById('status-panel') as HTMLDivElement;
  const progressIndicator = document.getElementById('progress-indicator') as HTMLDivElement;
  const progressText = document.getElementById('progress-text') as HTMLElement;
  const errorBanner = document.getElementById('error-banner') as HTMLDivElement;

  const resultSection = document.getElementById('result-section') as HTMLElement;
  const resultStats = document.getElementById('result-stats') as HTMLDivElement;
  const outputArea = document.getElementById('output-area') as HTMLTextAreaElement;
  const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;

  function setLoading(loading: boolean, text: string = '') {
    submitBtn.disabled = loading;
    submitBtnText.textContent = loading ? '提取中...' : '开始提取';
    statusPanel.classList.remove('hidden');

    if (loading) {
      progressIndicator.classList.remove('hidden');
      progressText.textContent = text;
      errorBanner.classList.add('hidden');
      errorBanner.textContent = '';
    } else {
      progressIndicator.classList.add('hidden');
    }
  }

  function showError(msg: string) {
    statusPanel.classList.remove('hidden');
    progressIndicator.classList.add('hidden');
    errorBanner.classList.remove('hidden');
    errorBanner.textContent = msg;
  }

  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();

    const rawUrl = repoUrlInput.value.trim();
    const token = tokenInput.value.trim();

    if (!rawUrl) {
      showError('请先输入 GitHub 仓库地址。');
      repoUrlInput.focus();
      return;
    }

    setLoading(true, '初始化提取任务...');
    resultSection.classList.add('hidden');

    try {
      const summary = await ingestRepository(rawUrl, {
        token: token || undefined,
        onProgress: (status: string) => {
          progressText.textContent = status;
        },
      });

      outputArea.value = summary.formattedOutput;
      resultStats.innerHTML = `已提取 <strong>${summary.files.length}</strong> 个文件 | 默认分支: <code>${summary.resolvedBranch}</code>`;
      resultSection.classList.remove('hidden');
      statusPanel.classList.add('hidden');
    } catch (err: unknown) {
      let displayMsg = '提取失败：遇到未知错误';
      if (err instanceof Error) {
        displayMsg = `提取失败: ${err.message}`;
      }
      showError(displayMsg);
    } finally {
      setLoading(false);
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!outputArea.value) return;
    try {
      await navigator.clipboard.writeText(outputArea.value);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '已复制到剪贴板！';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    } catch {
      outputArea.select();
      document.execCommand('copy');
      copyBtn.textContent = '已复制！';
    }
  });
});
