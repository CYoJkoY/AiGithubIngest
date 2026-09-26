import { SafeInputAdapter } from "../dom/input-adapter";
import * as ToastModule from "../ui/toast";
import { extractGitHubRepo } from "../core/parser";

// 兼容不同的 toast 导出方式：优先取 showToast，其次取 Toast.show 或 toast.show
function notify(message: string, type: "loading" | "success" | "error") {
  const toastAny = ToastModule as any;
  if (typeof toastAny.showToast === "function") {
    toastAny.showToast(message, type);
  } else if (toastAny.Toast && typeof toastAny.Toast.show === "function") {
    toastAny.Toast.show(message, type);
  } else if (toastAny.toast && typeof toastAny.toast.show === "function") {
    toastAny.toast.show(message, type);
  } else if (typeof toastAny.default === "function") {
    toastAny.default(message, type);
  }
}

export function attachPasteInterceptor(targetInput: HTMLElement) {
  targetInput.addEventListener("paste", async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData?.getData("text") || "";

    // 1. 调用解析器，返回 Result<RepoTarget, ParseError>
    const parseResult = extractGitHubRepo(clipboardData);

    // 2. 利用 Result.ok 进行严格类型收窄
    if (!parseResult.ok) {
      // 解析失败直接放行原生粘贴，不破坏用户输入
      return;
    }

    // 3. 拦截默认事件并保存快照
    event.preventDefault();
    const snapshot = SafeInputAdapter.captureSnapshot(targetInput);

    notify("正在解析 GitHub 仓库上下文...", "loading");

    // 4. 从 Result.value 中提取目标 URL 或标识
    const repoTarget = parseResult.value;
    // 如果 RepoTarget 结构本身包含 url 则使用，否则构造标准地址或使用原剪贴板文本
    const targetUrl =
      typeof repoTarget === "string"
        ? repoTarget
        : (repoTarget as any).url || clipboardData.trim();

    try {
      const response = await chrome.runtime.sendMessage({
        action: "FETCH_INGEST",
        url: targetUrl,
      });

      if (response && response.status === "ok") {
        // 成功：在原光标处精准插入内容
        SafeInputAdapter.insertAtCursor(targetInput, response.data, snapshot);
        notify("上下文注入成功", "success");
      } else {
        // 提取失败：触发安全回滚，将原始剪贴板文本插回，绝不丢失用户之前的内容
        SafeInputAdapter.rollbackToRawText(
          targetInput,
          clipboardData,
          snapshot,
        );
        notify(
          `提取失败: ${response?.error || "远程服务无响应"}，已恢复原链接`,
          "error",
        );
      }
    } catch (err) {
      // 异常崩溃分支：执行兜底回滚
      SafeInputAdapter.rollbackToRawText(targetInput, clipboardData, snapshot);
      notify("扩展通信异常，已恢复原输入", "error");
    }
  });
}
