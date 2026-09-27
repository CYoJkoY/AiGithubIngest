import { RepoTarget, SupportedLang } from '../types';
import { t } from './i18n';
import { DomainError } from './errors';

export class GitHubEngine {
  private static getHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'AiGithubIngest-Extension',
    };
    if (token && token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  public static async resolveBranch(
    target: RepoTarget,
    token?: string,
    lang: SupportedLang = 'zh-CN',
  ): Promise<string> {
    if (target.ref) return target.ref;

    const apiUrl = `https://api.github.com/repos/${target.owner}/${target.repo}`;
    try {
      const response = await fetch(apiUrl, { headers: this.getHeaders(token) });
      if (response.ok) {
        const data = (await response.json()) as { default_branch?: string };
        return data.default_branch || 'main';
      }
      if (response.status === 404) {
        throw new DomainError('REPO_NOT_FOUND', t('privateRepoNotice', lang));
      }
      if (response.status === 401 || response.status === 403) {
        if (token && token.trim()) {
          throw new DomainError(
            'AUTH_FAILED',
            t('authFailedWithStatus', lang, { status: response.status }),
          );
        }
        return 'main';
      }
    } catch (err) {
      if (err instanceof DomainError) throw err;
      // 网络异常时静默回退，由后续 fetchZipball 决定最终错误
    }
    return 'main';
  }

  public static async fetchZipball(
    target: RepoTarget,
    branch: string,
    token?: string,
    lang: SupportedLang = 'zh-CN',
  ): Promise<ArrayBuffer> {
    const headers = this.getHeaders(token);
    const apiUrl = branch
      ? `https://api.github.com/repos/${target.owner}/${target.repo}/zipball/${encodeURIComponent(branch)}`
      : `https://api.github.com/repos/${target.owner}/${target.repo}/zipball`;

    try {
      const response = await fetch(apiUrl, { headers, redirect: 'follow' });
      if (response.ok) return await response.arrayBuffer();
      if (response.status === 404) {
        throw new DomainError('REPO_NOT_FOUND', t('privateRepoNotice', lang));
      }
      if (token && token.trim()) {
        throw new DomainError(
          'DOWNLOAD_FAILED',
          t('downloadFailedWithStatus', lang, { status: response.status }),
        );
      }
    } catch (apiErr) {
      if (token && token.trim()) throw apiErr;
    }

    const fallbackBranches = target.ref ? [branch] : [branch, 'main', 'master'].filter(Boolean);
    for (const b of fallbackBranches) {
      const codeloadUrl = `https://codeload.github.com/${target.owner}/${target.repo}/legacy.zip/refs/heads/${encodeURIComponent(b)}`;
      try {
        const fallbackRes = await fetch(codeloadUrl);
        if (fallbackRes.ok) return await fallbackRes.arrayBuffer();
      } catch {
        continue;
      }
    }

    throw new DomainError('RATE_LIMITED', t('anonymousRateLimit', lang));
  }
}
