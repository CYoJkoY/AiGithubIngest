import { ingestRepository } from "../core/ingest";
import { ExtensionResponse, StorageSchema } from "../types";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "INGEST_REPO") {
    const targetUrl = message.payload?.url;

    if (!targetUrl || typeof targetUrl !== "string") {
      sendResponse({
        success: false,
        error: { code: "INVALID_URL", message: "目标仓库 URL 不能为空" },
      } as ExtensionResponse);
      return false;
    }

    // 从存储获取可选的 PAT
    chrome.storage.sync.get("githubToken", (items) => {
      const token = (items as StorageSchema).githubToken;

      ingestRepository(targetUrl, { token })
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
              message: err.message || "仓库代码树提取失败",
            },
          } as ExtensionResponse);
        });
    });

    return true; // 保持长连接通道以支持异步回调
  }

  return false;
});
