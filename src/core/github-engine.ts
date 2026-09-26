import { RepoTarget, GitTreeItem } from "../types";

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
   * 递归获取仓库全量 Git Tree
   */
  public static async fetchTree(
    target: RepoTarget,
    branch: string,
    token?: string,
  ): Promise<GitTreeItem[]> {
    const apiUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const response = await fetch(apiUrl, {
      headers: this.getHeaders(token),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`分支或 Commit ref [${branch}] 不存在`);
      }
      if (response.status === 403) {
        throw new Error(
          "GitHub API 访问受限，请在插件中配置 Personal Access Token",
        );
      }
      throw new Error(`获取代码树失败: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.tree || !Array.isArray(data.tree)) {
      throw new Error("GitHub 返回的代码树结构异常");
    }

    return data.tree as GitTreeItem[];
  }

  /**
   * 优先通过 raw.githubusercontent.com 抓取代码，节省 API 配额
   */
  public static async fetchRawFile(
    target: RepoTarget,
    branch: string,
    filePath: string,
    token?: string,
  ): Promise<string> {
    // 1. 无 Token 或公有库优先走 Raw CDN
    if (!token) {
      const rawUrl = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${encodeURIComponent(branch)}/${filePath}`;
      const res = await fetch(rawUrl);
      if (res.ok) {
        return await res.text();
      }
    }

    // 2. 携带 Token 或 Raw 失败时走 GitHub API contents 接口
    const apiUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(apiUrl, {
      headers: this.getHeaders(token),
    });

    if (!res.ok) {
      throw new Error(`获取文件内容失败 [${filePath}]: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.encoding === "base64" && typeof data.content === "string") {
      const sanitized = data.content.replace(/\s/g, "");
      const binaryStr = atob(sanitized);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return new TextDecoder("utf-8").decode(bytes);
    }

    return typeof data.content === "string" ? data.content : "";
  }
}
