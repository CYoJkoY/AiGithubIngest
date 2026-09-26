import { RepoTarget } from "../types";

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
    const response = await fetch(apiUrl, {
      headers: this.getHeaders(token),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `仓库 ${target.owner}/${target.repo} 不存在或为私有仓库（需在插件设置中配置 PAT）`,
        );
      }
      if (response.status === 403) {
        throw new Error(
          "已触发 GitHub 匿名速率上限 (60次/小时)，请在插件 Popup 中配置 GitHub Token",
        );
      }
      throw new Error(`获取仓库元数据失败: HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.default_branch || "main";
  }

  /**
   * 一次性获取全量代码 Zipball 二进制包（单次网络连接，规避 N+1 请求）
   */
  public static async fetchZipball(
    target: RepoTarget,
    branch: string,
    token?: string,
  ): Promise<ArrayBuffer> {
    const apiUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/zipball/${encodeURIComponent(branch)}`;
    const response = await fetch(apiUrl, {
      headers: this.getHeaders(token),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`分支或 Commit ref [${branch}] 不存在或无访问权限`);
      }
      if (response.status === 403) {
        throw new Error(
          "GitHub 访问超限，请在插件中配置 Personal Access Token 提升配额",
        );
      }
      throw new Error(`下载代码压缩包失败: HTTP ${response.status}`);
    }

    return await response.arrayBuffer();
  }
}
