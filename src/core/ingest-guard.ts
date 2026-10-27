import { INGEST_TIMEOUT_MS } from './constants';
import { logger } from './logger';

export class IngestGuard {
  private isProcessing = false;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  tryAcquire(): boolean {
    if (this.isProcessing) return false;
    this.isProcessing = true;
    this.armWatchdog();
    return true;
  }

  /** Restart the watchdog for a lock this guard already holds. */
  refresh(): void {
    if (!this.isProcessing) return;
    this.armWatchdog();
  }

  private armWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      logger.warn('IngestGuard watchdog timeout, resetting lock');
      this.reset();
    }, INGEST_TIMEOUT_MS);
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
