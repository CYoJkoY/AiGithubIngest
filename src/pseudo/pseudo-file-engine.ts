import type { PseudoFile, SupportedLang, ThemeMode } from '../types';
import type { DigestPart } from '../core/output-formatter';
import { logger } from '../core/logger';
import { PseudoFileManager, type RegisterFailure } from './pseudo-file-manager';
import { PseudoFileRenderer } from './pseudo-file-renderer';
import { SubmitInterceptor } from './submit-interceptor';

/**
 * Orchestrator for the pseudo-file pipeline:
 *
 *   Storage (PseudoFileManager) → View (PseudoFileRenderer) → Transport (SubmitInterceptor)
 *
 * One engine instance serves the current page. It is deliberately tiny: the
 * three collaborators own all behaviour, this module owns lifecycle only.
 */

export interface EngineMountResult {
  readonly ok: boolean;
  /** Files that made it into the dock. */
  readonly registered: number;
  /** Parts rejected by a guard clause. */
  readonly rejected: readonly RegisterFailure[];
}

export interface EngineCallbacks {
  readonly lang: SupportedLang;
  readonly theme: ThemeMode;
  readonly onFlushed?: (info: { readonly count: number; readonly chars: number }) => void;
  readonly onEmptied?: () => void;
}

export class PseudoFileEngine {
  private readonly manager: PseudoFileManager;
  private readonly renderer: PseudoFileRenderer;
  private readonly interceptor: SubmitInterceptor;

  constructor(callbacks: EngineCallbacks) {
    this.manager = new PseudoFileManager();
    this.renderer = new PseudoFileRenderer(this.manager, {
      lang: callbacks.lang,
      theme: callbacks.theme,
      // `onChange` is the single source of emptiness: it covers both a manual
      // card removal and a post-flush clear, so `onEmptied` fires exactly once.
      onChange: (count) => {
        if (count === 0) callbacks.onEmptied?.();
      },
    });
    this.interceptor = new SubmitInterceptor(this.manager, this.renderer, {
      lang: callbacks.lang,
      onFlushed: callbacks.onFlushed,
    });
  }

  get pending(): number {
    return this.manager.count;
  }

  get totalBytes(): number {
    return this.manager.totalBytes;
  }

  /**
   * True while the dock is still attached to the live document.
   *
   * SPA hosts destroy and rebuild composers on navigation; a dock whose root
   * is disconnected must be discarded, not reused.
   */
  isHealthy(): boolean {
    return this.renderer.isMounted && this.interceptor.isAttached;
  }

  /**
   * Register every digest part as a pseudo-file and dock it above `editor`.
   *
   * Returns `ok: false` when no editor could be resolved — the caller then
   * falls back to the real-file upload path, so a failed pseudo mount never
   * loses the user's ingest.
   */
  mount(parts: readonly DigestPart[], editor: HTMLElement | null): EngineMountResult {
    const rejected: RegisterFailure[] = [];
    const registered: PseudoFile[] = [];

    for (const part of parts) {
      const result = this.manager.register(part.fileName, part.content);
      if (result.ok) registered.push(result.file);
      else rejected.push(result.reason);
    }

    if (registered.length === 0) {
      return { ok: false, registered: 0, rejected };
    }

    const mounted = this.renderer.mount(editor);
    if (!mounted) {
      // Nothing was shown, so nothing can be submitted: release everything.
      this.manager.clear();
      return { ok: false, registered: 0, rejected };
    }

    for (const file of registered) this.renderer.add(file);

    const anchor = editor ?? this.renderer.root;
    if (!this.interceptor.isAttached) this.interceptor.attach(anchor);
    else this.interceptor.rebind(anchor);

    logger.info('PseudoFileEngine mounted', registered.length, 'part(s)');
    return { ok: true, registered: registered.length, rejected };
  }

  /** Manually flush pending files (used by the dock's explicit send action). */
  flush(): boolean {
    return this.interceptor.flush('manual');
  }

  dispose(): void {
    this.interceptor.detach();
    this.renderer.destroy();
  }
}
