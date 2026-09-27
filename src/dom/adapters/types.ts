import { logger } from '../../core/logger';

export interface AdapterContext {
  readonly file: File;
  readonly dataTransfer: DataTransfer;
  readonly activeElement: HTMLElement | null;
  readonly logger: typeof logger;
}

export interface AdapterResult {
  readonly success: boolean;
  readonly method: string;
}

export interface SiteAdapter {
  readonly id: string;
  matches(host: string, url: URL): boolean;
  attach(file: File, ctx: AdapterContext): Promise<AdapterResult>;
}
