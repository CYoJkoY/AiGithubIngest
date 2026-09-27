import { evaluateSitePolicyForHostnames } from '../core/policy';
import { extractGitHubRepo } from '../core/parser';
import { UniversalEditor } from '../dom/universal-editor';
import { showToast } from '../ui/toast';
import { ExtensionResponse } from '../types';
import { t } from '../core/i18n';
import { IngestGuard } from '../core/ingest-guard';
import { resolvePolicyHostnames, resolveActiveEditor, resolveEventTarget } from './policy-resolver';
import { cachedWhitelist, cachedBlacklist, cachedLang } from './storage-cache';

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
  let savedRange: { start: number; end: number } | undefined;
  if (targetElement instanceof HTMLTextAreaElement || targetElement instanceof HTMLInputElement) {
    savedRange = {
      start: targetElement.selectionStart ?? targetElement.value.length,
      end: targetElement.selectionEnd ?? targetElement.value.length,
    };
  }

  if (!guard.tryAcquire()) {
    showToast(t('taskInProgress', cachedLang), 'info');
    UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
    return;
  }

  const repo = parseResult.value;
  showToast(t('ingesting', cachedLang, { repo: `${repo.owner}/${repo.repo}` }), 'info', 3000);

  try {
    chrome.runtime.sendMessage(
      { type: 'INGEST_REPO', payload: { url: repo.canonicalUrl } },
      (response: ExtensionResponse) => {
        void (async () => {
          try {
            if (chrome.runtime.lastError || !response || !response.success) {
              const errorMsg =
                chrome.runtime.lastError?.message ||
                (response && !response.success
                  ? response.error.message
                  : 'Extension background response error');
              UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
              showToast(t('ingestFailed', cachedLang, { err: errorMsg }), 'error', 4500);
              return;
            }
            const summary = response.payload;
            const fileName = `${repo.owner}_${repo.repo}.md`;
            const virtualFile = new File([summary.formattedOutput], fileName, {
              type: 'text/markdown',
            });
            const attached = await UniversalEditor.attachVirtualFile(virtualFile, targetElement);
            if (attached) {
              showToast(
                t('attachedSuccess', cachedLang, {
                  file: fileName,
                  count: summary.files.length,
                }),
                'success',
                4000,
              );
            } else {
              const safeFallbackText = [
                `\n${t('fallbackDigestHeader', cachedLang, { repo: `${repo.owner}/${repo.repo}` })}`,
                `> ${t('fallbackFileCount', cachedLang, { count: summary.files.length, tokens: summary.estimatedTokens })}`,
                '```',
                summary.treeVisual.trim(),
                '```',
                `${t('fallbackHint', cachedLang)}\n`,
              ].join('\n');
              UniversalEditor.insertAtCursor(safeFallbackText, targetElement, savedRange);
              showToast(t('fallbackMounted', cachedLang), 'info', 4000);
            }
          } finally {
            guard.reset();
          }
        })();
      },
    );
  } catch (err) {
    guard.reset();
    UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
    const errMsg = err instanceof Error ? err.message : 'Error';
    showToast(`${t('networkError', cachedLang)} (${errMsg})`, 'error');
  }
}
