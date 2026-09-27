import { IngestGuard } from '../core/ingest-guard';
import { logger } from '../core/logger';
import { handlePasteEvent } from './paste-handler';
import { setupSpaRouteListener } from './spa-listener';
import { setupStorageListener, refreshStorageConfig } from './storage-cache';

declare global {
  interface Window {
    __aigiInitialized?: boolean;
  }
}

if (!window.__aigiInitialized) {
  window.__aigiInitialized = true;
  const guard = new IngestGuard();

  const pasteHandler = (e: ClipboardEvent): void => void handlePasteEvent(e, guard);

  window.addEventListener('paste', pasteHandler, true);
  document.addEventListener('paste', pasteHandler, true);

  setupSpaRouteListener(guard);
  setupStorageListener();
  void refreshStorageConfig();

  logger.info('listeners registered @', location.hostname);
}
