import type { PseudoFile, SupportedLang, ThemeMode } from '../types';
import type { DigestPart } from '../core/output-formatter';
import { logger } from '../core/logger';
import { PseudoFileManager, type RegisterFailure } from './pseudo-file-manager';
import { PseudoFileRenderer } from './pseudo-file-renderer';
import { SubmitInterceptor } from './submit-interceptor';

export interface EngineMountResult {
  readonly ok: boolean;
  readonly registered: number;
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
      onChange: (count) => {
        if (count === 0) callbacks.onEmptied?.();
      },
      onSendNow: () => {
        void this.interceptor.flushAndSubmit('manual');
      },
      onInsertNow: () => {
        this.interceptor.insertOnly();
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

  isHealthy(): boolean {
    return this.renderer.isMounted && this.interceptor.isAttached;
  }

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

  flush(): boolean {
    return this.interceptor.flush('manual');
  }

  dispose(): void {
    this.interceptor.detach();
    this.renderer.destroy();
  }
}
