import { evaluateSitePolicyForHostnames } from '../core/policy';
import { extractGitHubRepo } from '../core/parser';
import { UniversalEditor } from '../dom/universal-editor';
import { showToast } from '../ui/toast';
import { ExtensionResponse } from '../types';
import { t } from '../core/i18n';
import { IngestGuard } from '../core/ingest-guard';
import { DomainError } from '../core/errors';
import { logger } from '../core/logger';
import { resolvePolicyHostnames, resolveActiveEditor, resolveEventTarget } from './policy-resolver';
import { cachedWhitelist, cachedBlacklist, cachedLang } from './storage-cache';

interface SavedRange {
  start: number;
  end: number;
}

/**
 * 一次 ingest 流程中需要跨多个阶段共享的上下文。
 * 打包成对象以降低参数个数，同时让 send / handle 两段逻辑共享同一份引用。
 */
interface IngestContext {
  readonly rawText: string;
  readonly targetElement: HTMLElement | null;
  readonly savedRange: SavedRange | undefined;
  readonly guard: IngestGuard;
  /** 「正在解析」Toast 的延迟定时器 id；收到结果后立即清除 */
  readonly ingestingTimer: number;
}

/**
 * 所有与「当前这次 ingest 流程」相关的 Toast 共享同一个 replaceKey，
 * 保证「正在解析」「成功」「失败」「降级」这几类提示互相顶替，不会叠加闪烁。
 */
const INGEST_STATUS_TOAST_KEY = 'ingest-status';

/**
 * 「正在解析」Toast 延迟 800ms 再弹出：
 * 若请求快速返回，用户只会看到最终结果 Toast；
 * 若请求较慢，用户也能感知到插件确实在工作。
 */
const INGESTING_TOAST_DELAY_MS = 800;

export async function handlePasteEvent(event: ClipboardEvent, guard: IngestGuard): Promise<void> {
  const policy = evaluateSitePolicyForHostnames(
    resolvePolicyHostnames(),
    cachedWhitelist,
    cachedBlacklist,
  );
  if (policy === 'DISABLED' || policy === 'DISABLED_BLACKLIST') return;

  const rawText = event.clipboardData?.getData('text/plain')?.trim() ?? '';
  const parseResult = extractGitHubRepo(rawText);
  if (!parseResult.ok) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const targetElement = resolveActiveEditor(resolveEventTarget(event));
  const savedRange = captureRange(targetElement);

  if (!guard.tryAcquire()) {
    showToast(t('taskInProgress', cachedLang), 'info');
    UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
    return;
  }

  const repo = parseResult.value;

  const ingestingTimer = window.setTimeout(() => {
    showToast(
      t('ingesting', cachedLang, { repo: `${repo.owner}/${repo.repo}` }),
      'info',
      3000,
      INGEST_STATUS_TOAST_KEY,
    );
  }, INGESTING_TOAST_DELAY_MS);

  const ctx: IngestContext = { rawText, targetElement, savedRange, guard, ingestingTimer };

  try {
    sendIngestMessage(repo.canonicalUrl, ctx);
  } catch (err) {
    window.clearTimeout(ingestingTimer);
    guard.reset();
    UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
    const errMsg = err instanceof Error ? err.message : 'Error';
    logger.warn('sendMessage failed', err);
    showToast(
      `${t('networkError', cachedLang)} (${errMsg})`,
      'error',
      3000,
      INGEST_STATUS_TOAST_KEY,
    );
  }
}

function captureRange(el: HTMLElement | null): SavedRange | undefined {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  }
  return undefined;
}

function sendIngestMessage(url: string, ctx: IngestContext): void {
  chrome.runtime.sendMessage(
    { type: 'INGEST_REPO', payload: { url } },
    (response: ExtensionResponse) => {
      // 无论成功失败，先取消延迟中的「正在解析」Toast，避免它晚于结果出现
      window.clearTimeout(ctx.ingestingTimer);
      void handleIngestResponse(response, ctx);
    },
  );
}

async function handleIngestResponse(
  response: ExtensionResponse,
  ctx: IngestContext,
): Promise<void> {
  const { rawText, targetElement, savedRange, guard } = ctx;

  try {
    if (chrome.runtime.lastError || !response || !response.success) {
      const errorMsg = resolveErrorMessage(response);
      UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
      showToast(
        t('ingestFailed', cachedLang, { err: errorMsg }),
        'error',
        4500,
        INGEST_STATUS_TOAST_KEY,
      );
      return;
    }

    const summary = response.payload;
    const repoMatch = /github\.com\/([^/]+)\/([^/?#]+)/.exec(summary.repoInfo.canonicalUrl);
    const owner = repoMatch?.[1] ?? 'repo';
    const repoName = repoMatch?.[2] ?? 'digest';
    const fileName = `${owner}_${repoName}.md`;
    const virtualFile = new File([summary.formattedOutput], fileName, { type: 'text/markdown' });

    const attached = await UniversalEditor.attachVirtualFile(virtualFile, targetElement);
    if (attached) {
      showToast(
        t('attachedSuccess', cachedLang, { file: fileName, count: summary.files.length }),
        'success',
        4000,
        INGEST_STATUS_TOAST_KEY,
      );
      return;
    }

    const safeFallbackText = [
      `\n${t('fallbackDigestHeader', cachedLang, { repo: `${owner}/${repoName}` })}`,
      `> ${t('fallbackFileCount', cachedLang, { count: summary.files.length, tokens: summary.estimatedTokens })}`,
      '```',
      summary.treeVisual.trim(),
      '```',
      `${t('fallbackHint', cachedLang)}\n`,
    ].join('\n');
    UniversalEditor.insertAtCursor(safeFallbackText, targetElement, savedRange);
    showToast(t('fallbackMounted', cachedLang), 'info', 4000, INGEST_STATUS_TOAST_KEY);
  } catch (err) {
    const domainErr = DomainError.from(err);
    logger.error('handleIngestResponse failed', domainErr);
    showToast(
      t('ingestFailed', cachedLang, { err: domainErr.message }),
      'error',
      4500,
      INGEST_STATUS_TOAST_KEY,
    );
  } finally {
    guard.reset();
  }
}

function resolveErrorMessage(response: ExtensionResponse | undefined): string {
  if (chrome.runtime.lastError) return chrome.runtime.lastError.message ?? 'runtime error';
  if (response && !response.success) return response.error.message;
  return 'Extension background response error';
}
