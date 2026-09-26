import { ingestRepository } from "../core/ingest";
import { ExtensionResponse, StorageSchema } from "../types";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "INGEST_REPO") {
    const targetUrl = message.payload?.url;

    if (!targetUrl || typeof targetUrl !== "string") {
      sendResponse({
        success: false,
        error: {
          code: "INVALID_URL",
          message: "Target repository URL is required.",
        },
      } as ExtensionResponse);
      return false;
    }

    // 从 Chrome Storage 获取用户设置的 Token 与语言偏好
    chrome.storage.sync.get(["githubToken", "lang"], (items) => {
      const config = items as StorageSchema;
      const token = config.githubToken;
      const lang = config.lang || "zh-CN";

      ingestRepository(targetUrl, { token, lang })
        .then((summary) => {
          sendResponse({
            success: true,
            payload: summary,
          } as ExtensionResponse);
        })
        .catch((err: Error) => {
          sendResponse({
            success: false,
            error: {
              code: "INGEST_FAILED",
              message: err.message,
            },
          } as ExtensionResponse);
        });
    });

    return true; // 保持长连接通道以支持异步回调响应
  }

  return false;
});
