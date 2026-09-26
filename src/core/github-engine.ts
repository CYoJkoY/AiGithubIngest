import {
  RepoTarget,
  GitTreeItem,
  IngestFileResult,
  IngestSummary,
  IngestOptions,
} from "../types";

export class GitHubEngine {
  private static readonly RAW_BASE = "https://raw.githubusercontent.com";
  private static readonly API_BASE = "https://api.github.com";

  private static getHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (token && token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  public static async resolveBranch(
    target: RepoTarget,
    token?: string,
  ): Promise<string> {
    if (target.ref) return target.ref;
    const res = await fetch(
      `${this.API_BASE}/repos/${target.owner}/${target.repo}`,
      {
        headers: this.getHeaders(token),
      },
    );
    if (!res.ok) {
      if (res.status === 403)
        throw new Error("GitHub API 请求超频，请配置 GitHub Token 扩容配额");
      if (res.status === 404) throw new Error("仓库不存在或为私有仓库");
      throw new Error(`获取仓库信息失败: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.default_branch || "main";
  }

  public static async fetchTree(
    target: RepoTarget,
    branch: string,
    token?: string,
  ): Promise<GitTreeItem[]> {
    const res = await fetch(
      `${this.API_BASE}/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      {
        headers: this.getHeaders(token),
      },
    );
    if (!res.ok) {
      throw new Error(`读取目录树失败: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.tree || [];
  }

  /**
   * 优先使用 raw.githubusercontent.com 读取文件，不消耗 REST API 速率配额
   */
  public static async fetchRawFile(
    target: RepoTarget,
    branch: string,
    path: string,
  ): Promise<string> {
    const rawUrl = `${this.RAW_BASE}/${target.owner}/${target.repo}/${branch}/${path}`;
    const res = await fetch(rawUrl);
    if (!res.ok) {
      throw new Error(`无法下载文件 [${path}]: HTTP ${res.status}`);
    }
    return await res.text();
  }
}
