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

      // 拦截命中 GitHub 链接的粘贴事件
      event.preventDefault();
      event.stopPropagation();

      const targetElement = event.target as HTMLElement | null;

      // 立即快照捕获当前输入框的光标位置，防止后台拉取期间光标丢失导致冲刷
      let savedRange: { start: number; end: number } | undefined;
      if (
        targetElement instanceof HTMLTextAreaElement ||
        targetElement instanceof HTMLInputElement
      ) {
        savedRange = {
          start: targetElement.selectionStart ?? targetElement.value.length,
          end: targetElement.selectionEnd ?? targetElement.value.length,
        };
      }

      if (isProcessing) {
        showToast("已有提取任务正在进行中，已恢复原样粘贴", "info");
        UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
        return;
      }

      const repo = parseResult.value;
      isProcessing = true;
      showToast(
        `本地引擎正在提取 ${repo.owner}/${repo.repo} 代码树...`,
        "info",
        4000,
      );

      try {
        chrome.runtime.sendMessage(
          { type: "INGEST_REPO", payload: { url: repo.canonicalUrl } },
          (response: ExtensionResponse) => {
            isProcessing = false;

            if (!response || !response.success) {
              // 失败回退：精准放回原链接，确保已有文本绝对不丢失
              UniversalEditor.insertAtCursor(
                rawText,
                targetElement,
                savedRange,
              );
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

            UniversalEditor.insertAtCursor(
              injectedText,
              targetElement,
              savedRange,
            );
            showToast(
              `已成功注入 ${repo.owner}/${repo.repo} 代码上下文 (${summary.files.length} 个文件)`,
              "success",
            );
          },
        );
      } catch {
        isProcessing = false;
        UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
        showToast("与后台通信失败，已回退为普通链接", "error");
      }
    },
    true,
  );
};

void initialize();
