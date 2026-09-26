import { RepoTarget, SupportedLang } from "../types";
import { t } from "./i18n";

export class GitHubEngine {
  private static getHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AiGithubIngest-Extension",
    };
    if (token && token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  /**
   * 解析仓库默认分支或验证当前指定的分支（支持带 Token 访问私有仓库）
   */
  public static async resolveBranch(
    target: RepoTarget,
    token?: string,
    lang: SupportedLang = "zh-CN",
  ): Promise<string> {
    if (target.ref) {
      return target.ref;
    }

    const apiUrl = `https://api.github.com/repos/${target.owner}/${target.repo}`;
    try {
      const response = await fetch(apiUrl, {
        headers: this.getHeaders(token),
      });

      if (response.ok) {
        const data = await response.json();
        return data.default_branch || "main";
      }

      if (response.status === 404) {
        throw new Error(t("privateRepoNotice", lang));
      }

      if (response.status === 401 || response.status === 403) {
        if (token && token.trim()) {
          throw new Error(
            lang === "en"
              ? `GitHub API Authentication failed (HTTP ${response.status}). Please check your PAT permissions.`
              : `GitHub API 鉴权失败 (HTTP ${response.status})，请检查 Token 有效性及 repo 权限。`,
          );
        }
        return "main";
      }
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
    }

    return "main";
  }

  /**
   * 获取全量代码 Zipball（通道 1：官方 API，支持私有仓库及 Token；通道 2：公开直链兜底）
   */
  public static async fetchZipball(
    target: RepoTarget,
    branch: string,
    token?: string,
    lang: SupportedLang = "zh-CN",
  ): Promise<ArrayBuffer> {
    const headers = this.getHeaders(token);

    // 通道 1: GitHub REST API (带 Token 访问私有项目需使用此接口)
    const apiUrl = branch
      ? `https://api.github.com/repos/${target.owner}/${target.repo}/zipball/${encodeURIComponent(branch)}`
      : `https://api.github.com/repos/${target.owner}/${target.repo}/zipball`;

    try {
      const response = await fetch(apiUrl, {
        headers,
        redirect: "follow",
      });

      if (response.ok) {
        return await response.arrayBuffer();
      }

      if (response.status === 404) {
        throw new Error(t("privateRepoNotice", lang));
      }

      if (token && token.trim()) {
        throw new Error(
          t("downloadFailedWithStatus", lang, { status: response.status }),
        );
      }
    } catch (apiErr) {
      if (token && token.trim()) {
        throw apiErr;
      }
    }

    // 通道 2: codeload 直链兜底（仅限无 Token 且为公共仓库时）
    const fallbackBranches = [branch, "main", "master"].filter(Boolean);
    for (const b of fallbackBranches) {
      const codeloadUrl = `https://codeload.github.com/${target.owner}/${target.repo}/legacy.zip/refs/heads/${encodeURIComponent(b)}`;
      try {
        const fallbackRes = await fetch(codeloadUrl);
        if (fallbackRes.ok) {
          return await fallbackRes.arrayBuffer();
        }
      } catch {
        continue;
      }
    }

    throw new Error(t("anonymousRateLimit", lang));
  }
}
