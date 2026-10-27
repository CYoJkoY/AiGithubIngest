import type { GitHubTarget, GitHubUrlType, ParseError, RepoTarget, SupportedLang } from '../types';
import { extractGitHubRepo } from './parser';
import type { Result } from './result';
import { err, ok } from './result';
import { t } from './i18n';

const TRAVERSAL_SEGMENTS = new Set<string>(['.', '..']);

function hasTraversal(value: string): boolean {
  return value
    .split('/')
    .filter(Boolean)
    .some((segment) => TRAVERSAL_SEGMENTS.has(segment));
}

function hasRawTraversal(rawText: string | null | undefined): boolean {
  if (!rawText) return false;
  try {
    return hasTraversal(decodeURIComponent(rawText));
  } catch {
    return false;
  }
}

function resolveGranularity(
  edgeType: 'tree' | 'blob' | undefined,
  hasRef: boolean,
  hasSubpath: boolean,
): GitHubUrlType {
  if (edgeType === 'blob') return 'blob';
  if (!hasRef) return 'repo_root';
  if (edgeType === 'tree' && hasSubpath) return 'subpath';
  return 'branch_root';
}

/**
 * Classify a GitHub URL into a semantic target without performing I/O.
 *
 * The existing extractor remains the single source of truth for URL syntax;
 * this module only adds granularity and path-safety semantics.
 */
export function classifyGitHubUrl(
  rawText: string | null | undefined,
  lang: SupportedLang = 'zh-CN',
): Result<GitHubTarget, ParseError> {
  if (hasRawTraversal(rawText)) {
    return err({ code: 'NOT_GITHUB_URL', message: t('parseUnsafePath', lang) });
  }
  const parsed = extractGitHubRepo(rawText, lang);
  if (!parsed.ok) return err(parsed.error);

  const target = parsed.value;
  const ref = target.ref ?? '';
  const subpath = target.subpath ?? '/';
  if (hasTraversal(ref) || hasTraversal(subpath)) {
    return err({ code: 'NOT_GITHUB_URL', message: t('parseUnsafePath', lang) });
  }

  const type = resolveGranularity(target.type, ref.length > 0, subpath !== '/');
  return ok({
    owner: target.owner,
    repo: target.repo,
    ref,
    subpath,
    type,
    canonicalUrl: target.canonicalUrl,
  });
}

/** Convert a semantic target back to the legacy repository contract. */
export function toRepoTarget(target: GitHubTarget): RepoTarget {
  return {
    owner: target.owner,
    repo: target.repo,
    ref: target.ref || undefined,
    type: target.type === 'blob' ? 'blob' : target.type === 'repo_root' ? undefined : 'tree',
    subpath: target.subpath,
    canonicalUrl: target.canonicalUrl,
  };
}
