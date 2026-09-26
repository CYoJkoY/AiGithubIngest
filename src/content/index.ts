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

      event.preventDefault();
      event.stopPropagation();

      const targetElement = event.target as HTMLElement | null;

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
        showToast("已有提取任务进行中，已恢复普通文本粘贴", "info");
        UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
        return;
      }

      const repo = parseResult.value;
      isProcessing = true;
      showToast(`正在解析并提取 ${repo.owner}/${repo.repo}...`, "info", 3000);

      try {
        chrome.runtime.sendMessage(
          { type: "INGEST_REPO", payload: { url: repo.canonicalUrl } },
          (response: ExtensionResponse) => {
            isProcessing = false;

            if (chrome.runtime.lastError || !response || !response.success) {
              const errorMsg =
                chrome.runtime.lastError?.message ||
                (response && !response.success
                  ? response.error.message
                  : "扩展后台响应异常");

              UniversalEditor.insertAtCursor(
                rawText,
                targetElement,
                savedRange,
              );
              showToast(
                `提取失败: ${errorMsg}，已回退为普通链接`,
                "error",
                4500,
              );
              return;
            }

            const summary = response.payload;
            const fileName = `${repo.owner}_${repo.repo}.md`;

            const virtualFile = new File([summary.formattedOutput], fileName, {
              type: "text/markdown",
            });

            const attached = UniversalEditor.attachVirtualFile(
              virtualFile,
              targetElement,
            );

            if (attached) {
              showToast(
                `已成功作为文件附件挂载 ${fileName} (${summary.files.length} 个文件)`,
                "success",
                4000,
              );
            } else {
              const safeFallbackText = [
                `\n[已解析 GitHub 仓库: ${repo.owner}/${repo.repo}]`,
                `> 包含文件数: ${summary.files.length} | 预估 Token: ${summary.estimatedTokens}`,
                "```",
                summary.treeVisual.trim(),
                "```",
                "提示: 建议在输入框附带具体需求分析。\n",
              ].join("\n");

              UniversalEditor.insertAtCursor(
                safeFallbackText,
                targetElement,
                savedRange,
              );

              showToast(
                "已挂载结构概览至输入框，已启用防卡死保护",
                "info",
                4000,
              );
            }
          },
        );
      } catch (err) {
        isProcessing = false;
        UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
        const errMsg = err instanceof Error ? err.message : "通信异常";
        showToast(`通信失败: ${errMsg}，已恢复原链接`, "error");
      }
    },
    true,
  );
};

void initialize();
