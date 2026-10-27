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

  it('refresh extends the watchdog for a lock already held', () => {
    const guard = new IngestGuard();
    expect(guard.tryAcquire()).toBe(true);
    vi.advanceTimersByTime(12_000);
    guard.refresh();
    vi.advanceTimersByTime(12_000);
    // Still locked: the refreshed watchdog has not fired yet.
    expect(guard.tryAcquire()).toBe(false);
    vi.advanceTimersByTime(4_000);
    expect(guard.tryAcquire()).toBe(true);
    guard.dispose();
  });

  it('refresh on an unheld lock does not arm a watchdog', () => {
    const guard = new IngestGuard();
    guard.refresh();
    expect(guard.tryAcquire()).toBe(true);
    guard.dispose();
  });
});
