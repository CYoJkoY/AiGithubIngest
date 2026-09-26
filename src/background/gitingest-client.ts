export interface IngestResponse {
  success: boolean;
  data?: string;
  error?: string;
}

export class GitIngestClient {
  private static readonly API_ENDPOINT = "https://gitingest.com/api/ingest";
  private static readonly TIMEOUT_MS = 45000;

  public static async fetchRepoContext(
    repoUrl: string,
  ): Promise<IngestResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

    try {
      const response = await fetch(this.API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          url: repoUrl,
          pattern_type: "exclude",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText.slice(0, 100) || "GitIngest 服务不可用"}`,
        };
      }

      const jsonResult = await response.json();

      // GitIngest API 通常返回 { content: string } 或 { text: string }
      const content = jsonResult.content || jsonResult.text || jsonResult.data;
      if (!content) {
        return {
          success: false,
          error: "返回的仓库数据为空",
        };
      }

      return {
        success: true,
        data: content,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        return {
          success: false,
          error: "仓库提取超时（超过45秒），建议手动导入",
        };
      }
      return { success: false, error: err.message || "网络请求错误" };
    }
  }
}
