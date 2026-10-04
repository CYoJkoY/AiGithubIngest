import { evaluateSitePolicyForHostnames, resolveSiteLimit } from '../core/policy';
import { extractGitHubRepo } from '../core/parser';
import { OutputFormatter, type DigestPart } from '../core/output-formatter';
import { UniversalEditor } from '../dom/universal-editor';
import { showToast } from '../ui/toast';
import { ExtensionResponse, IngestSummary } from '../types';
import { t } from '../core/i18n';
import { IngestGuard } from '../core/ingest-guard';
import { DomainError } from '../core/errors';
import { logger } from '../core/logger';
import { PseudoFileEngine } from '../pseudo/pseudo-file-engine';
import { formatBytes } from '../pseudo/payload';
import { resolvePolicyHostnames, resolveActiveEditor, resolveEventTarget } from './policy-resolver';
import { sleep } from '../dom/dom-utils';
import { SavedRange } from '../dom/editor-writer';
import {
  cachedWhitelist,
  cachedBlacklist,
  cachedLang,
  cachedTheme,
  cachedDigestSendMode,
  cachedSiteFileSizeLimits,
  cachedDefaultFileSizeLimit,
} from './storage-cache';

interface IngestContext {
  readonly rawText: string;
  readonly targetElement: HTMLElement | null;
  readonly savedRange: SavedRange | undefined;
  readonly guard: IngestGuard;
  readonly ingestingTimer: number;
}

type MountOutcome = 'mounted' | 'partial' | 'failed';

const INGEST_STATUS_TOAST_KEY = 'ingest-status';
const INGESTING_TOAST_DELAY_MS = 800;
const MULTI_PART_INTERVAL_MS = 300;
const MULTI_PART_PROGRESS_MS = 30000;
const LARGE_PAYLOAD_NOTICE_BYTES = 150 * 1024;

export async function handlePasteEvent(event: ClipboardEvent, guard: IngestGuard): Promise<void> {
  const policy = evaluateSitePolicyForHostnames(
    resolvePolicyHostnames(),
    cachedWhitelist,
    cachedBlacklist,
  );
  if (policy === 'DISABLED' || policy === 'DISABLED_BLACKLIST') return;

  const rawText = event.clipboardData?.getData('text/plain')?.trim() ?? '';
  const parseResult = extractGitHubRepo(rawText, cachedLang);
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
    const outcome = await mountDigestParts(summary, targetElement);

    if (outcome === 'mounted' || outcome === 'partial') return;

    insertFallback(summary, targetElement, savedRange);
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

function extractOwnerRepo(canonicalUrl: string): { owner: string; repo: string } {
  const m = /github\.com\/([^/]+)\/([^/?#]+)/.exec(canonicalUrl);
  return { owner: m?.[1] ?? 'repo', repo: m?.[2] ?? 'digest' };
}

function buildDigestParts(summary: IngestSummary): DigestPart[] {
  const { owner, repo } = extractOwnerRepo(summary.repoInfo.canonicalUrl);
  const baseName = `${owner}_${repo}`;

  const summaryPrefix = OutputFormatter.createSummaryPrefix(
    summary.repoInfo,
    summary.resolvedBranch,
    summary.files.length,
    summary.estimatedTokens,
  );

  const limit = resolveSiteLimit(
    window.location.hostname,
    cachedSiteFileSizeLimits,
    cachedDefaultFileSizeLimit,
  );

  return OutputFormatter.splitIntoParts(
    summaryPrefix,
    summary.treeVisual,
    summary.files,
    limit,
    baseName,
  );
}

/**
 * Delivery router: pseudo-file mode first when selected, real-file upload as
 * the guaranteed path.
 *
 * A pseudo mount that cannot find a composer must never lose the digest, so
 * it falls through to the upload pipeline instead of reporting failure.
 */
async function mountDigestParts(
  summary: IngestSummary,
  targetElement: HTMLElement | null,
): Promise<MountOutcome> {
  const parts = buildDigestParts(summary);

  if (cachedDigestSendMode === 'pseudo-file') {
    const pseudoOutcome = mountPseudoParts(parts, targetElement);
    if (pseudoOutcome === 'mounted') return 'mounted';
    showToast(t('pseudoModeUnavailable', cachedLang), 'info', 4000, INGEST_STATUS_TOAST_KEY);
  }

  return mountRealParts(parts, summary, targetElement);
}

/** Text stays in memory; only metadata cards reach the DOM. */
function mountPseudoParts(
  parts: readonly DigestPart[],
  targetElement: HTMLElement | null,
): MountOutcome {
  const editor = targetElement ?? resolveActiveEditor(null);
  const engine = resolveEngine();
  const result = engine.mount(parts, editor);

  if (!result.ok) return 'failed';

  if (result.rejected.length > 0) {
    showToast(
      t('pseudoLimitHit', cachedLang, { skipped: result.rejected.length }),
      'error',
      6000,
      INGEST_STATUS_TOAST_KEY,
    );
  }

  showToast(
    t('pseudoMounted', cachedLang, { count: result.registered }),
    'success',
    4000,
    INGEST_STATUS_TOAST_KEY,
  );

  if (engine.totalBytes > LARGE_PAYLOAD_NOTICE_BYTES) {
    const totalBytes = engine.totalBytes;
    window.setTimeout(() => {
      showToast(
        t('pseudoLargePayloadNotice', cachedLang, { size: formatBytes(totalBytes) }),
        'info',
        5000,
        'pseudo-payload-notice',
      );
    }, 500);
  }

  return 'mounted';
}

/**
 * Drop the page's pseudo-file dock.
 *
 * Called on SPA navigation: the host composer is about to be rebuilt, so any
 * pending digest would be flushed into a node that no longer exists.
 */
export function disposePseudoEngine(): void {
  activeEngine?.dispose();
  activeEngine = null;
}

let activeEngine: PseudoFileEngine | null = null;

/**
 * Reuse the page's engine across pastes so successive digests stack in one
 * dock, but never reuse one whose dock was destroyed by a SPA navigation.
 */
function resolveEngine(): PseudoFileEngine {
  if (activeEngine && activeEngine.isHealthy()) return activeEngine;

  activeEngine?.dispose();
  activeEngine = new PseudoFileEngine({
    lang: cachedLang,
    theme: cachedTheme,
    onFlushed: ({ count }) => {
      showToast(t('pseudoFlushed', cachedLang, { count }), 'success', 3500);
    },
    onEmptied: () => {
      activeEngine?.dispose();
      activeEngine = null;
    },
  });
  return activeEngine;
}

async function mountRealParts(
  parts: readonly DigestPart[],
  summary: IngestSummary,
  targetElement: HTMLElement | null,
): Promise<MountOutcome> {
  if (parts.length === 1) {
    const file = new File([parts[0].content], parts[0].fileName, { type: 'text/markdown' });
    const ok = await UniversalEditor.attachVirtualFile(file, targetElement);
    if (ok) {
      showToast(
        t('attachedSuccess', cachedLang, { file: parts[0].fileName, count: summary.files.length }),
        'success',
        4000,
        INGEST_STATUS_TOAST_KEY,
      );
      return 'mounted';
    }
    return 'failed';
  }

  for (let i = 0; i < parts.length; i++) {
    showToast(
      t('attachingPart', cachedLang, { current: i + 1, total: parts.length }),
      'info',
      MULTI_PART_PROGRESS_MS,
      INGEST_STATUS_TOAST_KEY,
    );
    const file = new File([parts[i].content], parts[i].fileName, { type: 'text/markdown' });
    const ok = await UniversalEditor.attachVirtualFile(file, targetElement);
    if (!ok) {
      showToast(
        t('partialAttachFailed', cachedLang, { current: i + 1, total: parts.length }),
        'error',
        6000,
        INGEST_STATUS_TOAST_KEY,
      );
      return 'partial';
    }
    if (i < parts.length - 1) await sleep(MULTI_PART_INTERVAL_MS);
  }

  showToast(
    t('attachedMultiPart', cachedLang, { count: parts.length }),
    'success',
    4000,
    INGEST_STATUS_TOAST_KEY,
  );

  return 'mounted';
}

function insertFallback(
  summary: IngestSummary,
  targetElement: HTMLElement | null,
  savedRange: SavedRange | undefined,
): void {
  const { owner, repo } = extractOwnerRepo(summary.repoInfo.canonicalUrl);
  const safeFallbackText = [
    `\n${t('fallbackDigestHeader', cachedLang, { repo: `${owner}/${repo}` })}`,
    `> ${t('fallbackFileCount', cachedLang, { count: summary.files.length, tokens: summary.estimatedTokens })}`,
    '```',
    summary.treeVisual.trim(),
    '```',
    `${t('fallbackHint', cachedLang)}\n`,
  ].join('\n');
  UniversalEditor.insertAtCursor(safeFallbackText, targetElement, savedRange);
  showToast(t('fallbackMounted', cachedLang), 'info', 4000, INGEST_STATUS_TOAST_KEY);
}
