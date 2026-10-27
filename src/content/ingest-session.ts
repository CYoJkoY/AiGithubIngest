import {
  FULL_INGEST_MAX_TOKENS,
  INGEST_HEARTBEAT_MS,
  STATUS_PILL_FADE_MS,
} from '../core/constants';
import { DomainError } from '../core/errors';
import type { IngestGuard } from '../core/ingest-guard';
import { t } from '../core/i18n';
import { logger } from '../core/logger';
import type { ExtensionResponse, IngestStrategyType, IngestSummary, SupportedLang } from '../types';
import type { SavedRange } from '../dom/editor-writer';
import { StatusPill } from '../ui/status-pill';
import { showToast } from '../ui/toast';
import { cachedLang, cachedTheme } from './storage-cache';

export const INGEST_STATUS_TOAST_KEY = 'ingest-status';

const INGESTING_TOAST_DELAY_MS = 800;
/** Matches the pill's fade transition so removal happens off-screen. */
const FADE_REMOVE_MS = 260;

export type DeliverDigest = (
  summary: IngestSummary,
  targetElement: HTMLElement | null,
  savedRange: SavedRange | undefined,
) => Promise<void>;

export interface IngestStartInput {
  readonly url: string;
  /** Owner/name used by the fallback toast before any response arrives. */
  readonly repoLabel: string;
  readonly targetElement: HTMLElement | null;
  readonly savedRange: SavedRange | undefined;
  /** Put the original link back when the background request fails. */
  readonly revert: () => void;
}

export interface IngestSessionOptions {
  readonly guard: IngestGuard;
  readonly deliver: DeliverDigest;
}

interface RequestOverrides {
  readonly forceStrategy?: IngestStrategyType;
  readonly subpath?: string;
  readonly maxTokenBudget?: number;
}

function resolveErrorMessage(response: ExtensionResponse | undefined): string {
  if (chrome.runtime.lastError) return chrome.runtime.lastError.message ?? 'runtime error';
  if (response && !response.success) return response.error.message;
  return 'Extension background response error';
}

/**
 * Owns one ingest request at a time: the status pill, the guard heartbeat,
 * and user-requested strategy overrides.
 *
 * The guard is released only once a request is delivered or has definitively
 * failed, so a retry triggered from the degraded pill can reacquire it.
 */
export class IngestSession {
  private readonly guard: IngestGuard;
  private readonly deliver: DeliverDigest;
  private pill: StatusPill | null = null;
  private request: IngestStartInput | null = null;
  private lang: SupportedLang = cachedLang;
  private heartbeat: number | null = null;
  private fallbackTimer: number | null = null;
  /** True once the original link was restored or already replaced by a digest. */
  private originalHandled = false;
  private delivered = false;

  constructor(options: IngestSessionOptions) {
    this.guard = options.guard;
    this.deliver = options.deliver;
  }

  /** Send the first request; throws when the runtime channel is unavailable. */
  start(input: IngestStartInput): void {
    this.request = input;
    this.lang = cachedLang;
    this.originalHandled = false;
    this.delivered = false;
    this.send({});
  }

  /** Drop timers and the widget without touching a delivery already in flight. */
  dispose(): void {
    this.endRequest();
    this.disposePill();
    this.request = null;
  }

  private send(overrides: RequestOverrides, retrying = false): void {
    const request = this.request;
    if (request === null) return;
    this.clearFallbackTimer();

    const pill = this.ensurePill(request.targetElement);
    if (pill === null) this.scheduleFallbackToast(request);
    else if (retrying) pill.showRetrying(t('statusRetrying', this.lang));
    else pill.showAnalyzing(t('statusAnalyzing', this.lang));

    this.startHeartbeat();
    try {
      chrome.runtime.sendMessage(
        { type: 'INGEST_REPO', payload: { url: request.url, ...overrides } },
        (response: ExtensionResponse) => {
          this.handleResponse(response);
        },
      );
    } catch (err) {
      this.endRequest();
      this.guard.reset();
      this.disposePill();
      throw err;
    }
  }

  private ensurePill(anchor: HTMLElement | null): StatusPill | null {
    const live = this.pill;
    if (live !== null && live.root !== null) return live;

    const lang = this.lang;
    const pill = new StatusPill({
      anchor,
      theme: cachedTheme,
      labels: {
        close: t('statusClose', lang),
        forceFull: t('statusForceFull', lang),
        subpath: t('statusSubpath', lang),
        subpathPlaceholder: t('statusSubpathPlaceholder', lang),
        apply: t('statusApply', lang),
      },
      onForceFull: () => {
        this.retry({ forceStrategy: 'full', maxTokenBudget: FULL_INGEST_MAX_TOKENS });
      },
      onSubpath: (subpath) => {
        this.retry({ subpath });
      },
      onDismiss: () => {
        this.disposePill();
      },
    });
    if (!pill.mount()) return null;

    this.pill = pill;
    return pill;
  }

  private retry(overrides: RequestOverrides): void {
    if (this.request === null) return;
    // A newer paste may hold the lock now, so never steal its request.
    if (!this.guard.tryAcquire()) {
      showToast(t('taskInProgress', this.lang), 'info');
      return;
    }
    try {
      this.send(overrides, true);
    } catch (err) {
      // The channel vanished mid-flight; send() already released the guard
      // and retired the pill, so only the toast is left to report.
      const domainErr = DomainError.from(err);
      logger.warn('retry sendMessage failed', domainErr);
      showToast(
        t('ingestRetryFailed', this.lang, { err: domainErr.message }),
        'error',
        4500,
        INGEST_STATUS_TOAST_KEY,
      );
    }
  }

  private handleResponse(response: ExtensionResponse | undefined): void {
    this.endRequest();
    const request = this.request;
    if (request === null) return;

    if (chrome.runtime.lastError || !response || !response.success) {
      this.fail(request, resolveErrorMessage(response));
      return;
    }
    void this.complete(request, response.payload);
  }

  private async complete(request: IngestStartInput, summary: IngestSummary): Promise<void> {
    try {
      await this.deliver(summary, request.targetElement, request.savedRange);
      this.delivered = true;
      this.originalHandled = true;
    } catch (err) {
      const domainErr = DomainError.from(err);
      logger.error('digest delivery failed', domainErr);
      showToast(
        t('ingestFailed', this.lang, { err: domainErr.message }),
        'error',
        4500,
        INGEST_STATUS_TOAST_KEY,
      );
    } finally {
      this.guard.reset();
    }
    this.showOutcome(summary);
  }

  private showOutcome(summary: IngestSummary): void {
    const pill = this.pill;
    if (pill === null) return;
    const lang = this.lang;

    if (summary.strategy === 'skeleton') {
      const files = summary.preflight?.fileCount ?? summary.files.length;
      // A truncated tree forces the skeleton, so a full retry cannot succeed.
      const canForceFull = summary.preflight?.truncated !== true;
      pill.showDegraded(t('statusDegraded', lang, { files }), canForceFull);
      return;
    }

    const repo = summary.repoInfo.owner + '/' + summary.repoInfo.repo;
    pill.showReady(t('statusReady', lang, { repo, files: summary.files.length }));
    this.scheduleRemoval(pill);
  }

  private fail(request: IngestStartInput, message: string): void {
    this.guard.reset();
    // Delivery already replaced the link; only restore it when nothing landed.
    const alreadyHandled = this.delivered || this.originalHandled;
    if (!alreadyHandled) {
      this.originalHandled = true;
      request.revert();
    }
    const messageKey = alreadyHandled ? 'ingestRetryFailed' : 'ingestFailed';
    showToast(t(messageKey, this.lang, { err: message }), 'error', 4500, INGEST_STATUS_TOAST_KEY);

    const pill = this.pill;
    if (pill === null) return;
    pill.showError(t('statusError', this.lang, { err: message }));
    this.scheduleRemoval(pill);
  }

  private scheduleRemoval(pill: StatusPill): void {
    window.setTimeout(() => {
      pill.fadeOut();
      window.setTimeout(() => {
        pill.dispose();
        if (this.pill === pill) this.pill = null;
      }, FADE_REMOVE_MS);
    }, STATUS_PILL_FADE_MS);
  }

  private disposePill(): void {
    this.pill?.dispose();
    this.pill = null;
  }

  private scheduleFallbackToast(request: IngestStartInput): void {
    this.fallbackTimer = window.setTimeout(() => {
      this.fallbackTimer = null;
      showToast(
        t('ingesting', this.lang, { repo: request.repoLabel }),
        'info',
        3000,
        INGEST_STATUS_TOAST_KEY,
      );
    }, INGESTING_TOAST_DELAY_MS);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = window.setInterval(() => {
      this.guard.refresh();
    }, INGEST_HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return;
    window.clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private clearFallbackTimer(): void {
    if (this.fallbackTimer === null) return;
    window.clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
  }

  private endRequest(): void {
    this.stopHeartbeat();
    this.clearFallbackTimer();
  }
}
