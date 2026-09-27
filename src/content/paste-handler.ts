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
  showToast(t('ingesting', cachedLang, { repo: `${repo.owner}/${repo.repo}` }), 'info', 3000);

  try {
    sendIngestMessage(repo.canonicalUrl, rawText, targetElement, savedRange, guard);
  } catch (err) {
    guard.reset();
    UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
    const errMsg = err instanceof Error ? err.message : 'Error';
    logger.warn('sendMessage failed', err);
    showToast(`${t('networkError', cachedLang)} (${errMsg})`, 'error');
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

function sendIngestMessage(
  url: string,
  rawText: string,
  targetElement: HTMLElement | null,
  savedRange: SavedRange | undefined,
  guard: IngestGuard,
): void {
  chrome.runtime.sendMessage(
    { type: 'INGEST_REPO', payload: { url } },
    (response: ExtensionResponse) => {
      void handleIngestResponse(response, rawText, targetElement, savedRange, guard);
    },
  );
}

async function handleIngestResponse(
  response: ExtensionResponse,
  rawText: string,
  targetElement: HTMLElement | null,
  savedRange: SavedRange | undefined,
  guard: IngestGuard,
): Promise<void> {
  try {
    if (chrome.runtime.lastError || !response || !response.success) {
      const errorMsg = resolveErrorMessage(response);
      UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
      showToast(t('ingestFailed', cachedLang, { err: errorMsg }), 'error', 4500);
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
    showToast(t('fallbackMounted', cachedLang), 'info', 4000);
  } catch (err) {
    const domainErr = DomainError.from(err);
    logger.error('handleIngestResponse failed', domainErr);
    showToast(t('ingestFailed', cachedLang, { err: domainErr.message }), 'error', 4500);
  } finally {
    guard.reset();
  }
}

function resolveErrorMessage(response: ExtensionResponse | undefined): string {
  if (chrome.runtime.lastError) return chrome.runtime.lastError.message ?? 'runtime error';
  if (response && !response.success) return response.error.message;
  return 'Extension background response error';
}
