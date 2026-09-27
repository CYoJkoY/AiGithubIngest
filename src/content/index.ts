import { evaluateSitePolicy } from "../core/policy";
import { extractGitHubRepo } from "../core/parser";
import { UniversalEditor } from "../dom/universal-editor";
import { showToast } from "../ui/toast";
import { ExtensionResponse, StorageSchema, SupportedLang } from "../types";
import { t } from "../core/i18n";

let isProcessing = false;
let processingWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

// 本地策略与国际化缓存
let cachedWhitelist: readonly string[] = [];
let cachedBlacklist: readonly string[] = [];
let cachedLang: SupportedLang = "zh-CN";

/**
 * 刷新扩展配置缓存
 */
const refreshStorageConfig = async (): Promise<void> => {
  const storageData = await new Promise<StorageSchema>((resolve) => {
    chrome.storage.sync.get(
      ["userWhitelist", "userBlacklist", "lang"],
      (res) => {
        resolve(res as StorageSchema);
      },
    );
  });

  cachedWhitelist = storageData.userWhitelist ?? [];
  cachedBlacklist = storageData.userBlacklist ?? [];
  cachedLang = storageData.lang || "zh-CN";
};

/**
 * 重置提取锁，防止单页应用中因异常导致永久死锁
 */
const resetProcessingLock = (): void => {
  isProcessing = false;
  if (processingWatchdogTimer) {
    clearTimeout(processingWatchdogTimer);
    processingWatchdogTimer = null;
  }
};

/**
 * 寻找当前界面最匹配的主输入框容器
 */
const resolveActiveEditor = (
  targetElement: HTMLElement | null,
): HTMLElement | null => {
  if (
    targetElement instanceof HTMLTextAreaElement ||
    targetElement instanceof HTMLInputElement ||
    (targetElement && targetElement.isContentEditable)
  ) {
    return targetElement;
  }

  // 降级探测当前可见的活跃编辑器
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"], [role="textbox"]',
    ),
  );

  return (
    candidates.find((el) => el.offsetWidth > 0 && el.offsetHeight > 0) ||
    targetElement
  );
};

/**
 * 核心粘贴拦截调度器
 */
const handlePasteEvent = async (event: ClipboardEvent): Promise<void> => {
  const currentHost = window.location.hostname;
  const policy = evaluateSitePolicy(
    currentHost,
    cachedWhitelist,
    cachedBlacklist,
  );

  // 严格遵循黑名单最高裁决权与非启用阻断
  if (policy === "DISABLED" || policy === "DISABLED_BLACKLIST") return;

  const rawText = event.clipboardData?.getData("text/plain")?.trim() ?? "";
  const parseResult = extractGitHubRepo(rawText);
  if (!parseResult.ok) return;

  // 核心拦截：彻底阻断宿主网站自带的普通文本粘贴与处理
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const targetElement = resolveActiveEditor(event.target as HTMLElement | null);

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
    showToast(t("taskInProgress", cachedLang), "info");
    UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
    return;
  }

  const repo = parseResult.value;
  isProcessing = true;

  // 15 秒看门狗保护：即使后台无响应或网络中断，强制解开锁，防止新会话卡死
  processingWatchdogTimer = setTimeout(() => {
    resetProcessingLock();
  }, 15000);

  showToast(
    t("ingesting", cachedLang, { repo: `${repo.owner}/${repo.repo}` }),
    "info",
    3000,
  );

  try {
    chrome.runtime.sendMessage(
      { type: "INGEST_REPO", payload: { url: repo.canonicalUrl } },
      (response: ExtensionResponse) => {
        // 使用 async IIFE 包装，以便 await 异步的文件挂载流程
        void (async () => {
          try {
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
                t("ingestFailed", cachedLang, { err: errorMsg }),
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

            const attached = await UniversalEditor.attachVirtualFile(
              virtualFile,
              targetElement,
            );

            if (attached) {
              showToast(
                t("attachedSuccess", cachedLang, {
                  file: fileName,
                  count: summary.files.length,
                }),
                "success",
                4000,
              );
            } else {
              // 降级回退：插入 ASCII 目录树概览，激活防卡死机制
              const safeFallbackText = [
                `\n${t("fallbackDigestHeader", cachedLang, { repo: `${repo.owner}/${repo.repo}` })}`,
                `> ${t("fallbackFileCount", cachedLang, { count: summary.files.length, tokens: summary.estimatedTokens })}`,
                "```",
                summary.treeVisual.trim(),
                "```",
                `${t("fallbackHint", cachedLang)}\n`,
              ].join("\n");

              UniversalEditor.insertAtCursor(
                safeFallbackText,
                targetElement,
                savedRange,
              );

              showToast(t("fallbackMounted", cachedLang), "info", 4000);
            }
          } finally {
            // 确保整个挂载或降级流程全部执行完毕后再释放锁，防止异步重入
            resetProcessingLock();
          }
        })();
      },
    );
  } catch (err) {
    resetProcessingLock();
    UniversalEditor.insertAtCursor(rawText, targetElement, savedRange);
    const errMsg = err instanceof Error ? err.message : "Error";
    showToast(`${t("networkError", cachedLang)} (${errMsg})`, "error");
  }
};

/**
 * 监听 SPA 路由变化，确保新开对话不刷新即可保持可用
 */
const setupSpaRouteListener = (): void => {
  const onLocationChange = (): void => {
    resetProcessingLock();
    void refreshStorageConfig();
  };

  window.addEventListener("popstate", onLocationChange);
  window.addEventListener("hashchange", onLocationChange);

  // 劫持 history.pushState 与 replaceState
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    onLocationChange();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    onLocationChange();
    return result;
  };
};

/**
 * 监听 Storage 动态变更，Popup 调整黑名单/白名单立即生效
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync") {
    if (changes.userWhitelist) {
      cachedWhitelist = changes.userWhitelist.newValue ?? [];
    }
    if (changes.userBlacklist) {
      cachedBlacklist = changes.userBlacklist.newValue ?? [];
    }
    if (changes.lang) {
      cachedLang = changes.lang.newValue || "zh-CN";
    }
  }
});

const initialize = async (): Promise<void> => {
  await refreshStorageConfig();
  setupSpaRouteListener();

  // 单通道 window 顶层捕获即可保证在宿主应用之前拦截
  window.addEventListener("paste", handlePasteEvent, true);
};

void initialize();
