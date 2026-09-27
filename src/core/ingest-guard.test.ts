import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IngestGuard } from './ingest-guard';

describe('IngestGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tryAcquire returns true once then false', () => {
    const guard = new IngestGuard();
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(false);
    guard.reset();
    expect(guard.tryAcquire()).toBe(true);
    guard.dispose();
  });

  it('watchdog auto-resets after INGEST_TIMEOUT_MS', () => {
    const guard = new IngestGuard();
    expect(guard.tryAcquire()).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(guard.tryAcquire()).toBe(true);
  });

  it('reset clears the watchdog', () => {
    const guard = new IngestGuard();
    guard.tryAcquire();
    guard.reset();
    expect(guard.tryAcquire()).toBe(true);
    guard.dispose();
  });
});
