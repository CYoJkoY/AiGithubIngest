import { IngestGuard } from '../core/ingest-guard';
import { refreshStorageConfig } from './storage-cache';

export function setupSpaRouteListener(guard: IngestGuard): void {
  const onLocationChange = (): void => {
    guard.reset();
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
  } catch {
    // history 劫持失败不影响主链路
  }
}
