import {
  evaluateSitePolicyForHostnames,
  normalizeHostname,
} from "../core/policy";
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
 * 解析所有候选 hostname：current / ancestorOrigins / referrer / top
 * 用于 iframe、about:blank、blob: 等场景的策略裁决
 */
const resolvePolicyHostnames = (): string[] => {
  const hostnames = new Set<string>();

  const add = (value?: string | null): void => {
    if (!value) return;
    try {
      const url = value.includes("://")
        ? new URL(value)
        : new URL(`https://${value}`);
      const host = normalizeHostname(url.hostname);
      if (host) hostnames.add(host);
    } catch {
      // ignore
    }
  };

  add(window.location.hostname);
  add(document.referrer);

  try {
    const ancestorOrigins = window.location.ancestorOrigins;
    if (ancestorOrigins) {
      for (let i = 0; i < ancestorOrigins.length; i++) {
        add(ancestorOrigins.item(i));
      }
    }
  } catch {
    // ignore
  }

  try {
    if (window.top && window.top.location) {
      add(window.top.location.hostname);
    }
  } catch {
    // 跨域 top，忽略
  }

  return Array.from(hostnames);
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
 * 从 event.composedPath() 中提取真正的可编辑节点，
 * 以支持 Shadow DOM / Quill / Lexical / ProseMirror 等嵌套编辑器。
 */
const resolveEventTarget = (event: ClipboardEvent): HTMLElement | null => {
  const path =
    typeof event.composedPath === "function" ? event.composedPath() : [];

  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;

    if (
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLInputElement ||
      node.isContentEditable ||
      node.closest('[contenteditable="true"]')
    ) {
      return node;
    }
  }

  return event.target instanceof HTMLElement ? event.target : null;
};

/**
 * 核心粘贴拦截调度器
 */
const handlePasteEvent = async (event: ClipboardEvent): Promise<void> => {
  const policy = evaluateSitePolicyForHostnames(
    resolvePolicyHostnames(),
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

  const targetElement = resolveActiveEditor(resolveEventTarget(event));

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

const initialize = (): void => {
  // 1. 同步注册捕获监听 —— 必须在任何 await 之前执行，
  //    否则宿主 SPA 的 stopImmediatePropagation 会吃掉事件。
  //    同时挂 window 与 document 作为双保险。
  window.addEventListener("paste", handlePasteEvent, true);
  document.addEventListener("paste", handlePasteEvent, true);

  // 2. SPA 路由监听（同步即可完成，不需要 await）
  setupSpaRouteListener();

  // 3. 异步刷新 storage 缓存，不阻塞监听注册
  void refreshStorageConfig();
};

void initialize();
