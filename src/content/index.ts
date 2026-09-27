import {
  evaluateSitePolicyForHostnames,
  normalizeHostname,
} from "../core/policy";
import { extractGitHubRepo } from "../core/parser";
import { UniversalEditor } from "../dom/universal-editor";
import { showToast } from "../ui/toast";
import { ExtensionResponse, StorageSchema, SupportedLang } from "../types";
import { t } from "../core/i18n";

// ============================================================
// 诊断探针：验证 content script 是否成功注入。
// 问题定位完成后可删除。
// ============================================================
console.log(
  "[AiGithubIngest] content script loaded @",
  location.hostname,
  "| readyState:",
  document.readyState,
);

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
    try {
      chrome.storage.sync.get(
        ["userWhitelist", "userBlacklist", "lang"],
        (res) => {
          resolve((res as StorageSchema) ?? {});
        },
      );
    } catch {
      resolve({});
    }
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
 * 从 event.composedPath() 中提取真正的可编辑节点
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

  if (policy === "DISABLED" || policy === "DISABLED_BLACKLIST") return;

  const rawText = event.clipboardData?.getData("text/plain")?.trim() ?? "";
  const parseResult = extractGitHubRepo(rawText);
  if (!parseResult.ok) return;

  // 核心拦截
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
 * 监听 SPA 路由变化
 */
const setupSpaRouteListener = (): void => {
  const onLocationChange = (): void => {
    resetProcessingLock();
    void refreshStorageConfig();
  };

  try {
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
  } catch {
    // history 劫持失败不影响主链路
  }
};

/**
 * 安全注册 storage 变更监听器
 * 放到 initialize 内部，避免 document_start 阶段可能的 API 不可用
 * 导致整个脚本中断。
 */
const setupStorageListener = (): void => {
  try {
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
  } catch (err) {
    console.warn("[AiGithubIngest] storage.onChanged listener failed:", err);
  }
};

const initialize = (): void => {
  // 1. 注册 paste 捕获监听器 —— 必须在最前面同步执行，
  //    任何 await 或可能抛异常的调用都会让监听器注册被推迟或跳过。
  window.addEventListener("paste", handlePasteEvent, true);
  document.addEventListener("paste", handlePasteEvent, true);

  // 2. SPA 路由监听（内部已有 try/catch）
  setupSpaRouteListener();

  // 3. Storage 变更监听（内部已有 try/catch）
  setupStorageListener();

  // 4. 异步刷新 storage 缓存，不阻塞监听注册
  void refreshStorageConfig();

  console.log("[AiGithubIngest] listeners registered @", location.hostname);
};

void initialize();
