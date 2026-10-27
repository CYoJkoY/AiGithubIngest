import { IngestGuard } from '../core/ingest-guard';
import { logger } from '../core/logger';
import { refreshStorageConfig } from './storage-cache';
import { disposePseudoEngine } from './paste-handler';
import { disposeStatusPill } from '../ui/status-pill';

export function setupSpaRouteListener(guard: IngestGuard): void {
  const onLocationChange = (): void => {
    guard.reset();
    // The host composer is about to be rebuilt; a dock anchored to the old
    // one can no longer deliver its payload.
    disposePseudoEngine();
    // The pill anchors to the composer being rebuilt, so retire it as well.
    disposeStatusPill();
    void refreshStorageConfig();
  };
  try {
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      onLocationChange();
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      onLocationChange();
      return result;
    };
  } catch (err) {
    logger.warn('Failed to install SPA route listener', err);
  }
}
