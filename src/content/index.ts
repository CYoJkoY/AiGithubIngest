import { IngestGuard } from '../core/ingest-guard';
import { handlePasteEvent } from './paste-handler';
import { setupSpaRouteListener } from './spa-listener';
import { setupStorageListener, refreshStorageConfig } from './storage-cache';

const guard = new IngestGuard();

const initialize = (): void => {
  window.addEventListener('paste', (e) => void handlePasteEvent(e, guard), true);
  document.addEventListener('paste', (e) => void handlePasteEvent(e, guard), true);
  setupSpaRouteListener(guard);
  setupStorageListener();
  void refreshStorageConfig();
  console.log('[AiGithubIngest] listeners registered @', location.hostname);
};

void initialize();
