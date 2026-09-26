import { GitIngestClient } from "./gitingest-client";
import { ExtensionResponse } from "../types";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message.type === "FETCH_GITINGEST" ||
    message.type === "INGEST_GITHUB_REPO"
  ) {
    const targetUrl =
      typeof message.payload?.url === "string"
        ? message.payload.url
        : typeof message.url === "string"
          ? message.url
          : "";

    if (!targetUrl) {
      sendResponse({
        success: false,
        error: {
          code: "EMPTY_PAYLOAD",
          message: "请求 URL 不能为空",
        },
      } as ExtensionResponse);
      return false;
    }

    GitIngestClient.fetchRepoContext(targetUrl)
      .then((result) => {
        if (result.success && result.data) {
          sendResponse({
            success: true,
            payload: {
              repoUrl: targetUrl,
              content: result.data,
            },
          } as ExtensionResponse);
        } else {
          sendResponse({
            success: false,
            error: {
              code: "HTTP_ERROR",
              status: 500,
              message: result.error || "GitIngest 服务不可用",
            },
          } as ExtensionResponse);
        }
      })
      .catch((err: Error) => {
        sendResponse({
          success: false,
          error: {
            code: "NETWORK_ERROR",
            message: err.message || "网络请求异常",
          },
        } as ExtensionResponse);
      });

    return true; // 保持异步响应信道连通
  }

  return false;
});
