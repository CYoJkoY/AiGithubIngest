import { RepoTarget } from "../types";

export class GitHubEngine {
  private static getHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (token && token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  /**
   * 解析仓库默认分支或验证当前指定的分支
   */
  public static async resolveBranch(
    target: RepoTarget,
    token?: string,
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
        throw new Error(
          `仓库 ${target.owner}/${target.repo} 不存在或为私有仓库（需在扩展 Popup 中配置 PAT）`,
        );
      }

      if (response.status === 403) {
        // 触发限流时，公共仓库降级返回 main
        return "main";
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("私有仓库")) {
        throw err;
      }
    }

    return "main";
  }

  /**
   * 一次性获取全量代码 Zipball 二进制包（双通道：API 优先，公共直链兜底）
   */
  public static async fetchZipball(
    target: RepoTarget,
    branch: string,
    token?: string,
  ): Promise<ArrayBuffer> {
    const headers = this.getHeaders(token);

    // 通道 1: GitHub REST API (带 Token 或支持私有库)
    const apiUrl = branch
      ? `https://api.github.com/repos/${target.owner}/${target.repo}/zipball/${encodeURIComponent(branch)}`
      : `https://api.github.com/repos/${target.owner}/${target.repo}/zipball`;

    try {
      const response = await fetch(apiUrl, { headers });

      if (response.ok) {
        return await response.arrayBuffer();
      }

      if (response.status === 404) {
        throw new Error(`分支或 Commit ref [${branch}] 不存在或无访问权限`);
      }

      // 如果未配置 Token 且遭遇 403 限流，进入通道 2 兜底
      if (response.status !== 403 || (token && token.trim())) {
        throw new Error(`下载代码压缩包失败: HTTP ${response.status}`);
      }
    } catch (apiErr) {
      if (token && token.trim()) {
        throw apiErr;
      }
    }

    // 通道 2: codeload 公共直链兜底（不受 GitHub API 60次/h 速率限制）
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

    throw new Error(
      "获取仓库压缩包失败：已达到 GitHub 匿名限额或网络异常，请在扩展中配置 GitHub Token",
    );
  }
}
