import { GitIngestClient } from "./gitingest-client";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "INGEST_GITHUB_REPO") {
    GitIngestClient.fetchRepoContext(message.url)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // 告知 Chrome 采用异步响应机制
  }
  return false; // 显式返回，解决“并非所有代码路径都返回值”报错
});
