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

      // 命中 GitHub 链接，拦截默认粘贴
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
      showToast(
        `本地 Zipball 单次流式提取 ${repo.owner}/${repo.repo}...`,
        "info",
        3000,
      );

      try {
        chrome.runtime.sendMessage(
          { type: "INGEST_REPO", payload: { url: repo.canonicalUrl } },
          (response: ExtensionResponse) => {
            isProcessing = false;

            if (!response || !response.success) {
              UniversalEditor.insertAtCursor(
                rawText,
                targetElement,
                savedRange,
              );
              showToast(
                `提取失败: ${response?.error?.message ?? "扩展后台无响应"}，已回退为链接`,
                "error",
              );
              return;
            }

            const summary = response.payload;
            const fileName = `${repo.owner}_${repo.repo}.md`;

            // 构建虚拟 Markdown File 对象
            const virtualFile = new File([summary.formattedOutput], fileName, {
              type: "text/markdown",
            });

            // 优先以虚拟附件形式挂载到编辑器
            const attached = UniversalEditor.attachVirtualFile(
              virtualFile,
              targetElement,
            );

            if (attached) {
              showToast(
                `已成功作为文件附件挂载 ${fileName} (${summary.files.length} 个文件)，页面零卡顿！`,
                "success",
                4000,
              );
            } else {
              // 宿主站点若拦截了程序化附件上传，则做轻量化结构降级：仅注入树状结构，避免浏览器假死
              const safeFallbackText = [
                `\n[已解析 GitHub 仓库: ${repo.owner}/${repo.repo}]`,
                `> 包含文件数: ${summary.files.length} | 预估 Token: ${summary.estimatedTokens}`,
                `\`\`\``,
                summary.treeVisual.trim(),
                `\`\`\``,
                `提示: 站点限制了模拟附件上传，建议在输入框附带具体需求分析。\n`,
              ].join("\n");

              UniversalEditor.insertAtCursor(
                safeFallbackText,
                targetElement,
                savedRange,
              );

              showToast(
                `已挂载结构概览至输入框，已启用防卡死保护`,
                "info",
                4000,
              );
            }
          },
        );
      } catch {
        isProcessing = false;
        UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
        showToast("通信失败，已恢复原链接", "error");
      }
    },
    true,
  );
};

void initialize();
