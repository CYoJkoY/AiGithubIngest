import { evaluateSitePolicy } from "../core/policy";
import { extractGitHubRepo } from "../core/parser";
import { isOk } from "../core/result";
import { buildIngestPrompt, buildLoadingPlaceholder } from "../core/prompt";
import {
  detectUniversalEditor,
  writeUniversalText,
} from "../dom/universal-editor";
import { showToast } from "../ui/toast";
import { ExtensionResponse, StorageSchema } from "../types";

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

    const editor = detectUniversalEditor(event.target);
    if (!editor) return;

    // 掐断后续传播，防止被富文本编辑器转换为 Chip/徽标节点
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const repo = parseResult.value;
    writeUniversalText(editor, buildLoadingPlaceholder(repo.owner, repo.repo));
    showToast(`正在提取 ${repo.owner}/${repo.repo} 代码树...`, "info");

    const ingestResult = await dispatchIngestRequest(repo.canonicalUrl);

    if (!ingestResult.success) {
      showToast(`提取失败: ${ingestResult.error.message}`, "error");
      writeUniversalText(editor, repo.canonicalUrl);
      return;
    }

    const promptText = buildIngestPrompt(ingestResult.payload);
    writeUniversalText(editor, promptText);
    showToast(
      `已成功注入 ${repo.owner}/${repo.repo} 项目结构与代码`,
      "success",
    );
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
