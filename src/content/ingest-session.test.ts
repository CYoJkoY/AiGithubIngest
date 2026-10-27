// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_INGEST_MAX_TOKENS } from '../core/constants';
import { IngestGuard } from '../core/ingest-guard';
import { t } from '../core/i18n';
import type { ExtensionResponse, IngestSummary } from '../types';
import type { SavedRange } from '../dom/editor-writer';
import { activeStatusPill, disposeStatusPill, StatusPill } from '../ui/status-pill';
import { IngestSession } from './ingest-session';

interface SendRecord {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

type Callback = (response: ExtensionResponse | undefined) => void;

function skeletonSummary(truncated = false): IngestSummary {
  return {
    repoInfo: { owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' },
    resolvedBranch: 'main',
    treeVisual: '',
    files: [],
    formattedOutput: '',
    estimatedTokens: '1',
    strategy: 'skeleton',
    preflight: {
      target: {
        owner: 'owner',
        repo: 'repo',
        ref: 'main',
        subpath: '/',
        type: 'repo_root',
        canonicalUrl: 'https://github.com/owner/repo',
      },
      totalBlobs: 10,
      fileCount: 10,
      estimatedTokens: 1,
      recommendedStrategy: 'skeleton',
      stackConfigs: [],
      truncated,
    },
  };
}

function installChrome(handler: (record: SendRecord, callback: Callback) => void): SendRecord[] {
  const records: SendRecord[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      sendMessage: (message: SendRecord, callback: Callback) => {
        records.push(message);
        handler(message, callback);
      },
    },
  });
  return records;
}

function shadowOf(pill: StatusPill): ShadowRoot {
  const root = pill.root?.shadowRoot;
  if (!root) throw new Error('pill is not mounted');
  return root;
}

function clickForceFull(pill: StatusPill): void {
  const shadow = shadowOf(pill);
  const body = shadow.querySelector<HTMLButtonElement>('.aigi-status-pill__body');
  const forceFull = shadow.querySelector<HTMLButtonElement>('.aigi-status-pill__action');
  if (!body || !forceFull) throw new Error('pill controls missing');
  body.click();
  forceFull.click();
}

function toastText(): string {
  return document.querySelector('.ai-github-ingest-toast')?.textContent ?? '';
}

/** Let queued delivery promises and their microtasks settle. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

let revert: ReturnType<typeof vi.fn>;
let deliverMock: ReturnType<
  typeof vi.fn<[IngestSummary, HTMLElement | null, SavedRange | undefined], Promise<void>>
>;
let guard: IngestGuard;
let session: IngestSession | null = null;

function startSession(): void {
  session = new IngestSession({
    guard,
    deliver: async (summary, target, range) => {
      await deliverMock(summary, target, range);
    },
  });
  const active = session;
  expect(guard.tryAcquire()).toBe(true);
  active.start({
    url: 'https://github.com/owner/repo',
    repoLabel: 'owner/repo',
    targetElement: null,
    savedRange: undefined,
    revert: () => {
      revert();
    },
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  revert = vi.fn();
  deliverMock = vi.fn<[IngestSummary, HTMLElement | null, SavedRange | undefined], Promise<void>>(
    async () => undefined,
  );
  guard = new IngestGuard();
});

afterEach(() => {
  session?.dispose();
  session = null;
  disposeStatusPill();
  guard?.dispose();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IngestSession transport', () => {
  it('sends only the canonical url on the first request', () => {
    const records = installChrome(() => undefined);
    startSession();

    expect(records).toHaveLength(1);
    expect(records[0].type).toBe('INGEST_REPO');
    expect(records[0].payload).toEqual({ url: 'https://github.com/owner/repo' });
  });

  it('sends strategy overrides and holds the lock until delivery completes', async () => {
    const records = installChrome((_record, callback) => {
      callback({ success: true, payload: skeletonSummary() });
    });
    startSession();
    await flush();

    const pill = activeStatusPill();
    if (!pill) throw new Error('expected a status pill');
    clickForceFull(pill);

    expect(records).toHaveLength(2);
    expect(records[1].payload).toEqual({
      url: 'https://github.com/owner/repo',
      forceStrategy: 'full',
      maxTokenBudget: FULL_INGEST_MAX_TOKENS,
    });
  });

  it('does not resend overrides while another paste holds the lock', async () => {
    const records = installChrome((_record, callback) => {
      callback({ success: true, payload: skeletonSummary() });
    });
    startSession();
    await flush();

    expect(guard.tryAcquire()).toBe(true);
    const pill = activeStatusPill();
    if (!pill) throw new Error('expected a status pill');
    clickForceFull(pill);

    expect(records).toHaveLength(1);
    expect(toastText()).toBe(t('taskInProgress', 'zh-CN'));
    expect(revert).not.toHaveBeenCalled();
  });
});

describe('IngestSession failure paths', () => {
  it('reverts the original link when the first request fails', () => {
    installChrome((_record, callback) => {
      callback({ success: false, error: { code: 'NETWORK', message: 'boom' } });
    });
    startSession();

    expect(revert).toHaveBeenCalledTimes(1);
    expect(toastText()).toBe(t('ingestFailed', 'zh-CN', { err: 'boom' }));
  });

  it('keeps the delivered digest when a retry fails', async () => {
    let calls = 0;
    installChrome((_record, callback) => {
      calls += 1;
      if (calls === 1) {
        callback({ success: true, payload: skeletonSummary() });
        return;
      }
      callback({ success: false, error: { code: 'NETWORK', message: 'retry boom' } });
    });
    startSession();
    await flush();

    const pill = activeStatusPill();
    if (!pill) throw new Error('expected a status pill');
    clickForceFull(pill);

    expect(revert).not.toHaveBeenCalled();
    expect(toastText()).toBe(t('ingestRetryFailed', 'zh-CN', { err: 'retry boom' }));
  });

  it('reports a synchronous channel failure from a retry without throwing', async () => {
    let calls = 0;
    installChrome((_record, callback) => {
      calls += 1;
      if (calls === 1) {
        callback({ success: true, payload: skeletonSummary() });
        return;
      }
      throw new Error('Extension context invalidated');
    });
    startSession();
    await flush();

    const pill = activeStatusPill();
    if (!pill) throw new Error('expected a status pill');
    expect(() => {
      clickForceFull(pill);
    }).not.toThrow();

    expect(revert).not.toHaveBeenCalled();
    expect(toastText()).toBe(
      t('ingestRetryFailed', 'zh-CN', { err: 'Extension context invalidated' }),
    );
  });

  it('hides Force full when the tree itself was truncated', async () => {
    installChrome((_record, callback) => {
      callback({ success: true, payload: skeletonSummary(true) });
    });
    startSession();
    await flush();

    const pill = activeStatusPill();
    if (!pill) throw new Error('expected a status pill');
    const shadow = shadowOf(pill);
    shadow.querySelector<HTMLButtonElement>('.aigi-status-pill__body')?.click();
    expect(shadow.querySelector<HTMLButtonElement>('.aigi-status-pill__action')?.hidden).toBe(true);
  });
});

describe('IngestSession status surface', () => {
  it('marks a retry as retrying before the response arrives', async () => {
    const callbacks: Callback[] = [];
    installChrome((_record, callback) => {
      callbacks.push(callback);
      if (callbacks.length === 1) callback({ success: true, payload: skeletonSummary() });
    });
    startSession();
    await flush();

    const pill = activeStatusPill();
    if (!pill) throw new Error('expected a status pill');
    clickForceFull(pill);

    expect(pill.root?.dataset.state).toBe('retrying');
    expect(shadowOf(pill).querySelector('.aigi-status-pill__text')?.textContent).toBe(
      t('statusRetrying', 'zh-CN'),
    );
  });

  it('stops touching the pill after disposal', async () => {
    let pending: Callback = () => undefined;
    installChrome((_record, callback) => {
      pending = callback;
    });
    startSession();
    if (session === null) throw new Error('expected an active session');
    session.dispose();
    pending({ success: true, payload: skeletonSummary() });

    expect(activeStatusPill()).toBeNull();
    expect(revert).not.toHaveBeenCalled();
    expect(deliverMock).not.toHaveBeenCalled();
  });
});
