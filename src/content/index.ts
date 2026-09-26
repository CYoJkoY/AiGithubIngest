import { evaluateSitePolicy } from "../core/policy";
import { extractGitHubRepo } from "../core/parser";
import { UniversalEditor } from "../dom/universal-editor";
import { showToast } from "../ui/toast";
import { ExtensionResponse, StorageSchema } from "../types";

let isProcessing = false;

const initialize = async (): Promise<void> => {
  const currentHost = window.location.hostname;
  const userWhitelist = await new Promise<readonly string[]>((resolve) => {
    chrome.storage.sync.get("userWhitelist", (res) => {
      resolve((res as StorageSchema).userWhitelist ?? []);
    });
  });

  if (evaluateSitePolicy(currentHost, userWhitelist) === "DISABLED") return;

  document.addEventListener(
    "paste",
    async (event: ClipboardEvent) => {
      const rawText = event.clipboardData?.getData("text/plain")?.trim() ?? "";
      const parseResult = extractGitHubRepo(rawText);
      if (!parseResult.ok) return;

      // 拦截命中仓库链接的粘贴，防止浏览器直接将纯文本乱序插入
      event.preventDefault();
      event.stopPropagation();

      const targetElement = event.target;
      if (isProcessing) {
        showToast("已有提取任务正在进行中，已保持原样粘贴", "info");
        UniversalEditor.insertAtCursor(rawText, targetElement);
        return;
      }

      const repo = parseResult.value;
      isProcessing = true;
      showToast(
        `正在提取 ${repo.owner}/${repo.repo} 代码上下文...`,
        "info",
        5000,
      );

      try {
        chrome.runtime.sendMessage(
          { type: "INGEST_REPO", payload: { url: repo.canonicalUrl } },
          (response: ExtensionResponse) => {
            isProcessing = false;

            if (!response || !response.success) {
              // 失败回退：原样插入剪贴板中的纯 URL，绝不冲刷用户在此期间打下的内容
              UniversalEditor.insertAtCursor(rawText, targetElement);
              showToast(
                `提取失败: ${response?.error?.message ?? "扩展后台无响应"}，已回退为普通链接`,
                "error",
              );
              return;
            }

            const summary = response.payload;
            const injectedText = [
              `\n\`\`\`markdown`,
              summary.formattedOutput,
              `\`\`\`\n`,
            ].join("\n");

            UniversalEditor.insertAtCursor(injectedText, targetElement);
            showToast(
              `已成功注入 ${repo.owner}/${repo.repo} 代码结构`,
              "success",
            );
          },
        );
      } catch (err: unknown) {
        isProcessing = false;
        UniversalEditor.insertAtCursor(rawText, targetElement);
        showToast("与后台通信失败，已回退为普通链接", "error");
      }
    },
    true,
  );
};

void initialize();
