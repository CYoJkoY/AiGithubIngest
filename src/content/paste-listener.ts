import { UniversalEditor } from "../dom/universal-editor";
import { Toast } from "../ui/toast";

const GITHUB_REPO_REGEX =
  /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(\/.*)?$/;

export class PasteListener {
  private isProcessing = false;

  public init(): void {
    document.addEventListener("paste", this.handlePaste.bind(this), true);
  }

  public destroy(): void {
    document.removeEventListener("paste", this.handlePaste.bind(this), true);
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const pastedText = clipboardData.getData("text").trim();
    if (!pastedText || !GITHUB_REPO_REGEX.test(pastedText)) {
      return; // 不是 GitHub 仓库链接，完全交由浏览器默认粘贴处理
    }

    // 命中目标，阻止默认粘贴，并由扩展接管
    event.preventDefault();

    if (this.isProcessing) {
      Toast.show("已有提取任务正在进行中，请稍候...", "info");
      // 正在处理其他任务时，把当前链接正常贴入，避免丢字
      UniversalEditor.insertAtCursor(pastedText);
      return;
    }

    this.isProcessing = true;
    Toast.show("正在提取 GitHub 仓库上下文...", "info");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "INGEST_GITHUB_REPO",
        url: pastedText,
      });

      if (!response || !response.success) {
        throw new Error(response?.error || "提取失败");
      }

      // 提取成功：仅在光标处插入解析所得的上下文，输入框原有内容完全保留
      UniversalEditor.insertAtCursor(response.data);
      Toast.show("仓库上下文已成功注入！", "success");
    } catch (error: any) {
      // 提取失败时：自动回退插入用户原本剪贴板中的纯 URL，确保输入不丢失
      UniversalEditor.insertAtCursor(pastedText);
      Toast.show(
        `仓库解析失败，已回退为普通链接: ${error.message || "网络或接口异常"}`,
        "error",
      );
    } finally {
      this.isProcessing = false;
    }
  }
}
