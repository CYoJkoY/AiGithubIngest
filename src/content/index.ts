import { evaluateSitePolicy } from "../core/policy";
import { extractGitHubRepo } from "../core/parser";
import { isOk } from "../core/result";
import { buildIngestPrompt } from "../core/prompt";
import { UniversalEditor } from "../dom/universal-editor";
import { showToast } from "../ui/toast";
import { ExtensionResponse, StorageSchema } from "../types";
export type { Result, Ok, Err } from "../core/result";

let isProcessing = false;

const fetchUserWhitelist = (): Promise<readonly string[]> => {
  return new Promise((resolve) => {
    chrome.storage.sync.get("userWhitelist", (res) => {
      const data = res as StorageSchema;
      resolve(data.userWhitelist ?? []);
    });
  });
};

const dispatchIngestRequest = (url: string): Promise<ExtensionResponse> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "FETCH_GITINGEST", payload: { url } },
      (response: ExtensionResponse) => {
        if (chrome.runtime.lastError || !response) {
          resolve({
            success: false,
            error: {
              code: "NETWORK_ERROR",
              message: chrome.runtime.lastError?.message || "扩展后台信道中断",
            },
          });
          return;
        }
        resolve(response);
      },
    );
  });
};

const initialize = async (): Promise<void> => {
  const currentHost = window.location.hostname;
  const userWhitelist = await fetchUserWhitelist();
  const policy = evaluateSitePolicy(currentHost, userWhitelist);

  // 严格拦截门禁：普通网站且不在白名单内，零开销退出，不注册任何 DOM 监听器
  if (policy === "DISABLED") {
    return;
  }

  const handleIntercept = async (
    event: ClipboardEvent | DragEvent,
    rawText: string,
  ): Promise<void> => {
    const parseResult = extractGitHubRepo(rawText);
    if (!isOk(parseResult)) return;

    // 命中 GitHub 链接，阻断默认粘贴/拖拽行为，防止被富文本编辑器转化为 Chip 节点或重复粘贴
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const targetElement = event.target;

    // 并发防御：已有任务在提取中时，安全在光标处插入纯文本，杜绝丢字
    if (isProcessing) {
      showToast("已有提取任务正在进行中，请稍候...", "info");
      UniversalEditor.insertAtCursor(rawText, targetElement);
      return;
    }

    const repo = parseResult.value;
    isProcessing = true;
    showToast(`正在提取 ${repo.owner}/${repo.repo} 代码树...`, "info");

    try {
      const ingestResult = await dispatchIngestRequest(repo.canonicalUrl);

      if (!ingestResult.success) {
        // 防御式降级：网络或解析失败时，回退插入用户原始链接，输入框原有文字完全保留
        UniversalEditor.insertAtCursor(rawText, targetElement);
        showToast(
          `提取失败 (${ingestResult.error.message})，已还原为原始链接`,
          "error",
        );
        return;
      }

      // 提取成功：仅在光标处安全插入完整提示词与代码树，完全保留前后文本
      const promptText = buildIngestPrompt(ingestResult.payload);
      const inserted = UniversalEditor.insertAtCursor(
        promptText,
        targetElement,
      );

      if (inserted) {
        showToast(
          `已成功注入 ${repo.owner}/${repo.repo} 项目结构与代码`,
          "success",
        );
      } else {
        UniversalEditor.insertAtCursor(rawText, targetElement);
        showToast("未能定位编辑焦点，已回退为普通链接", "error");
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "未知异常";
      UniversalEditor.insertAtCursor(rawText, targetElement);
      showToast(`处理异常 (${errMsg})，已还原为原始链接`, "error");
    } finally {
      isProcessing = false;
    }
  };

  document.addEventListener(
    "paste",
    (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      void handleIntercept(event, text);
    },
    true,
  );

  document.addEventListener(
    "drop",
    (event: DragEvent) => {
      const text =
        event.dataTransfer?.getData("text/uri-list") ||
        event.dataTransfer?.getData("text/plain") ||
        "";
      void handleIntercept(event, text);
    },
    true,
  );
};

void initialize();
