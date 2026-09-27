import { INGEST_TIMEOUT_MS } from './constants';
import { logger } from './logger';

export class IngestGuard {
  private isProcessing = false;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  tryAcquire(): boolean {
    if (this.isProcessing) return false;
    this.isProcessing = true;
    this.watchdogTimer = setTimeout(() => {
      logger.warn('IngestGuard watchdog timeout, resetting lock');
      this.reset();
    }, INGEST_TIMEOUT_MS);
    return true;
  }

  reset(): void {
    this.isProcessing = false;
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  dispose(): void {
    this.reset();
  }
}
