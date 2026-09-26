import { ExtensionMessage, ExtensionResponse } from "../types";

const GITINGEST_API_ENDPOINT = "https://gitingest.com/api/ingest";
const TIMEOUT_MS = 60000;

const fetchRepoFromGitingest = async (
  url: string,
): Promise<ExtensionResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(GITINGEST_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: "HTTP_ERROR",
          status: response.status,
          message: `Gitingest 返回状态异常: HTTP ${response.status}`,
        },
      };
    }

    const data = await response.json();
    const content = data.content || data.text || data.result;

    if (typeof content !== "string" || content.trim().length === 0) {
      return {
        success: false,
        error: {
          code: "EMPTY_PAYLOAD",
          message: "Gitingest 解析完成但未返回有效文本内容",
        },
      };
    }

    return {
      success: true,
      payload: { repoUrl: url, content },
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        error: {
          code: "NETWORK_TIMEOUT",
          message: "请求超时，代码库过大或远端处理过慢",
        },
      };
    }
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "连接 Gitingest 异常",
      },
    };
  }
};

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionResponse) => void,
  ): boolean => {
    if (message.type === "FETCH_GITINGEST") {
      fetchRepoFromGitingest(message.payload.url).then(sendResponse);
      return true;
    }
    return false;
  },
);
