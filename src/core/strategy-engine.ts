import {
  BYTES_PER_TOKEN,
  FULL_INGEST_MAX_FILES,
  FULL_INGEST_MAX_TOKENS,
  SUBPATH_INGEST_MAX_FILES,
} from './constants';
import type { IngestStrategyType, PreflightReport } from '../types';

export interface StrategyOptions {
  readonly forceStrategy?: IngestStrategyType;
  readonly tokenBudgetWarningThreshold?: number;
}

/** Coarse, allocation-free token estimate from preflight byte counts. */
export function estimateTokensFromBytes(totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  return Math.ceil(totalBytes / BYTES_PER_TOKEN);
}

/**
 * Resolve the delivery strategy from a preflight report.
 *
 * A truncated tree always forces the skeleton because a partial index cannot
 * truthfully represent a full digest. Explicit user overrides then win over
 * the remaining automatic thresholds.
 */
export function resolveIngestStrategy(
  report: PreflightReport,
  options: StrategyOptions = {},
): IngestStrategyType {
  if (report.truncated) return 'skeleton';
  if (options.forceStrategy) return options.forceStrategy;
  if (report.target.type === 'blob') return 'single';
  if (report.target.type === 'subpath' && report.validFiles.length <= SUBPATH_INGEST_MAX_FILES) {
    return 'subpath';
  }

  const tokenLimit = options.tokenBudgetWarningThreshold ?? FULL_INGEST_MAX_TOKENS;
  if (report.validFiles.length <= FULL_INGEST_MAX_FILES && report.estimatedTokens <= tokenLimit) {
    return 'full';
  }

  return 'skeleton';
}
