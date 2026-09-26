import { evaluateSitePolicy } from "../core/policy";
import { extractGitHubRepo } from "../core/parser";
import { UniversalEditor } from "../dom/universal-editor";
import { showToast } from "../ui/toast";
import { ExtensionResponse, StorageSchema, SupportedLang } from "../types";
import { t } from "../core/i18n";

let isProcessing = false;

const initialize = async (): Promise<void> => {
  const currentHost = window.location.hostname;
  const storageData = await new Promise<StorageSchema>((resolve) => {
    chrome.storage.sync.get(
      ["userWhitelist", "userBlacklist", "lang"],
      (res) => {
        resolve(res as StorageSchema);
      },
    );
  });

  const userWhitelist = storageData.userWhitelist ?? [];
  const userBlacklist = storageData.userBlacklist ?? [];
  const lang: SupportedLang = storageData.lang || "zh-CN";

  const policy = evaluateSitePolicy(currentHost, userWhitelist, userBlacklist);
  if (policy === "DISABLED" || policy === "DISABLED_BLACKLIST") return;

  document.addEventListener(
    "paste",
    async (event: ClipboardEvent) => {
      const rawText = event.clipboardData?.getData("text/plain")?.trim() ?? "";
      const parseResult = extractGitHubRepo(rawText);
      if (!parseResult.ok) return;

      // 核心修复：彻底阻断事件传播，防止宿主网站自身的粘贴监听器二次响应
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

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
        showToast(t("taskInProgress", lang), "info");
        UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
        return;
      }

      const repo = parseResult.value;
      isProcessing = true;
      showToast(
        t("ingesting", lang, { repo: `${repo.owner}/${repo.repo}` }),
        "info",
        3000,
      );

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
                  : "Extension background response error");

              UniversalEditor.insertAtCursor(
                rawText,
                targetElement,
                savedRange,
              );
              showToast(
                t("ingestFailed", lang, { err: errorMsg }),
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
                t("attachedSuccess", lang, {
                  file: fileName,
                  count: summary.files.length,
                }),
                "success",
                4000,
              );
            } else {
              const safeFallbackText = [
                `\n${t("fallbackDigestHeader", lang, { repo: `${repo.owner}/${repo.repo}` })}`,
                `> ${t("fallbackFileCount", lang, { count: summary.files.length, tokens: summary.estimatedTokens })}`,
                "```",
                summary.treeVisual.trim(),
                "```",
                `${t("fallbackHint", lang)}\n`,
              ].join("\n");

              UniversalEditor.insertAtCursor(
                safeFallbackText,
                targetElement,
                savedRange,
              );

              showToast(t("fallbackMounted", lang), "info", 4000);
            }
          },
        );
      } catch (err) {
        isProcessing = false;
        UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
        const errMsg = err instanceof Error ? err.message : "Error";
        showToast(`${t("networkError", lang)} (${errMsg})`, "error");
      }
    },
    true,
  );
};

void initialize();
