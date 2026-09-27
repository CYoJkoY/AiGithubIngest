export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = "";

  /**
   * 校验 file input 是否具备接收文本/文档附件的能力
   */
  private static isValidFileInput(
    input: HTMLInputElement,
    file: File,
  ): boolean {
    if (input.disabled) return false;
    const accept = input.accept?.trim();
    if (!accept) return true;

    const acceptLower = accept.toLowerCase();

    const isPureMedia =
      (acceptLower.includes("image/") ||
        acceptLower.includes(".jpg") ||
        acceptLower.includes(".png")) &&
      !acceptLower.includes("text") &&
      !acceptLower.includes(".txt") &&
      !acceptLower.includes(".doc") &&
      !acceptLower.includes(".pdf") &&
      !acceptLower.includes("*");

    if (isPureMedia) return false;

    const acceptPatterns = acceptLower
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (acceptPatterns.length === 0) return true;

    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();

    return acceptPatterns.some((pattern) => {
      if (pattern === "*/*" || pattern === "*") return true;
      if (
        pattern === ".txt" ||
        pattern === "text/plain" ||
        pattern === ".md" ||
        pattern === ".markdown" ||
        pattern === "text/markdown" ||
        pattern === ".doc" ||
        pattern === ".docx" ||
        pattern === ".pdf" ||
        pattern.includes("document")
      ) {
        return true;
      }
      if (pattern.startsWith(".")) {
        return fileName.endsWith(pattern);
      }
      if (pattern.endsWith("/*")) {
        const mimeCategory = pattern.slice(0, pattern.indexOf("/"));
        return (
          fileType.startsWith(`${mimeCategory}/`) || mimeCategory === "text"
        );
      }
      return fileType === pattern;
    });
  }

  /**
   * 清理并解绑物理 input 节点上的文件常驻状态
   */
  private static cleanUpFileInput(fileInput: HTMLInputElement): void {
    try {
      const emptyDT = new DataTransfer();
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files",
      );

      if (descriptor?.set) {
        descriptor.set.call(fileInput, emptyDT.files);
      } else {
        fileInput.files = emptyDT.files;
      }

      fileInput.value = "";

      const tracker = (
        fileInput as unknown as {
          _valueTracker?: { setValue: (val: string) => void };
        }
      )._valueTracker;

      if (tracker) {
        tracker.setValue("");
      }
    } catch {
      // 容错处理
    }
  }

  /**
   * 将文件挂载到指定 input
   */
  private static mountFileToInput(
    input: HTMLInputElement,
    dataTransfer: DataTransfer,
  ): void {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files",
      );

      if (descriptor?.set) {
        descriptor.set.call(input, dataTransfer.files);
      } else {
        input.files = dataTransfer.files;
      }

      const tracker = (
        input as unknown as {
          _valueTracker?: { setValue: (val: string) => void };
        }
      )._valueTracker;
      if (tracker) {
        tracker.setValue("");
      }

      input.dispatchEvent(
        new Event("input", { bubbles: true, composed: true }),
      );
      input.dispatchEvent(
        new Event("change", { bubbles: true, composed: true }),
      );

      console.log("[AiIngest] mountFileToInput: dispatched input/change");

      // 挂载完成后延迟清空物理 input，避免文件常驻
      setTimeout(() => {
        UniversalEditor.cleanUpFileInput(input);
      }, 1000);
    } catch (e) {
      console.log("[AiIngest] mountFileToInput failed", e);
    }
  }

  /**
   * 策略 1: 通用 file input 扫描（用于非豆包站点）
   */
  private static tryUploadViaFileInput(
    file: File,
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    const searchScopes = [
      activeEl?.closest("form"),
      activeEl?.closest('[class*="chat"]'),
      activeEl?.closest('[class*="input"]'),
      activeEl?.closest('[class*="editor"]'),
      activeEl?.closest('[class*="prompt"]'),
      activeEl?.closest('[role="presentation"]'),
      activeEl?.parentElement?.parentElement,
      document.querySelector('[role="main"]'),
      document.querySelector("main"),
      document.querySelector("#root"),
      document.querySelector("#app"),
      document.body,
    ].filter((scope): scope is Element => Boolean(scope));

    for (const scope of searchScopes) {
      const fileInputs = Array.from(
        scope.querySelectorAll<HTMLInputElement>('input[type="file"]'),
      );

      for (const fileInput of fileInputs) {
        if (!this.isValidFileInput(fileInput, file)) continue;
        this.mountFileToInput(fileInput, dataTransfer);
        return true;
      }
    }

    return false;
  }

  /**
   * 策略 2: 剪贴板事件仿真（保留给非豆包站点）
   */
  private static tryPasteEvent(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    const target =
      activeEl ||
      (document.querySelector(
        'textarea, [contenteditable="true"], [role="textbox"]',
      ) as HTMLElement | null);

    if (!target) return false;

    try {
      target.focus();

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });

      Object.defineProperty(pasteEvent, "clipboardData", {
        configurable: true,
        get() {
          return dataTransfer;
        },
      });

      target.dispatchEvent(pasteEvent);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 策略 3: 拖放事件仿真（保留给非豆包站点）
   */
  private static tryDragAndDrop(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    const candidateTarget =
      activeEl?.closest('[class*="chat"]') ||
      activeEl?.closest('[class*="input"]') ||
      activeEl ||
      document.querySelector('[data-dropzone="true"]') ||
      document.querySelector('[class*="dropzone"]') ||
      document.querySelector("main");

    if (!candidateTarget) return false;

    try {
      const eventInit: DragEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer,
      };

      candidateTarget.dispatchEvent(new DragEvent("dragenter", eventInit));
      candidateTarget.dispatchEvent(new DragEvent("dragover", eventInit));
      candidateTarget.dispatchEvent(new DragEvent("drop", eventInit));

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 豆包专用：通过 data-testid 精确定位 input / 触发按钮
   *
   * 从用户提供的豆包 DOM 得出精确选择器：
   *   - 附件按钮：button[data-testid="upload_file_button"]
   *   - 文件输入：input[data-testid="upload-file-input"] 或 input[type="file"]
   *   - input 的 accept 明确包含 .md，可直接上传 Markdown
   *
   * 关键难点与解决方案：
   *   合成 click 到附件按钮时，我们仍处于 paste 事件的 user gesture 上下文，
   *   豆包 React onClick 内部会调用 input.click()，Chrome 判定为"用户主动点击"，
   *   于是弹出系统文件选择器——但我们其实不需要它弹窗，因为文件我们直接挂载。
   *
   *   解决方案：在派发 click 期间临时 patch HTMLInputElement.prototype.click 和
   *   showPicker，让 type="file" 的 input 静默失败（阻止系统弹窗），同时让 React
   *   onClick 正常执行、input 正常渲染到 DOM。派发结束后立即恢复原型链，
   *   保证用户后续手动点击加号按钮时系统选择器仍正常弹出。
   */
  private static tryDoubaoUpload(
    file: File,
    dataTransfer: DataTransfer,
  ): boolean {
    console.log("[AiIngest] doubao: tryDoubaoUpload start");

    // 1. 快路径：input 可能已经在 DOM 中
    const directInput = document.querySelector<HTMLInputElement>(
      'input[data-testid="upload-file-input"], input[type="file"]',
    );

    if (directInput && this.isValidFileInput(directInput, file)) {
      console.log("[AiIngest] doubao: direct input found, mounting");
      this.mountFileToInput(directInput, dataTransfer);
      return true;
    }

    // 2. 慢路径：点击附件按钮触发 input 渲染（需临时 patch click / showPicker）
    const attachBtn = document.querySelector<HTMLElement>(
      'button[data-testid="upload_file_button"]',
    );

    if (!attachBtn) {
      console.log("[AiIngest] doubao: no attach button found");
      return false;
    }

    // 保存原始方法
    const originalClick = HTMLInputElement.prototype.click;
    const originalShowPicker = (
      HTMLInputElement.prototype as unknown as {
        showPicker?: () => void;
      }
    ).showPicker;

    let patched = false;

    // 临时 patch：拦截 type="file" 的 input，阻止系统文件选择器弹出
    try {
      HTMLInputElement.prototype.click = function (
        this: HTMLInputElement,
      ): void {
        if (this.type === "file") {
          console.log(
            "[AiIngest] doubao: suppressed native file picker (click)",
          );
          return;
        }
        return originalClick.call(this);
      };

      if (typeof originalShowPicker === "function") {
        (
          HTMLInputElement.prototype as unknown as {
            showPicker: () => void;
          }
        ).showPicker = function (this: HTMLInputElement): void {
          if (this.type === "file") {
            console.log(
              "[AiIngest] doubao: suppressed native file picker (showPicker)",
            );
            return;
          }
          return originalShowPicker.call(this);
        };
      }

      patched = true;
      console.log("[AiIngest] doubao: click/showPicker patched");
    } catch (e) {
      console.log("[AiIngest] doubao: patch failed", e);
    }

    // 派发合成 click 触发 React onClick，让豆包渲染出 input
    console.log(
      "[AiIngest] doubao: dispatching synthetic click on attach button",
    );
    try {
      attachBtn.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    } catch (e) {
      console.log("[AiIngest] doubao: click dispatch failed", e);
    } finally {
      // 立即恢复原始方法，避免影响后续用户正常操作
      if (patched) {
        try {
          HTMLInputElement.prototype.click = originalClick;
          if (typeof originalShowPicker === "function") {
            (
              HTMLInputElement.prototype as unknown as {
                showPicker: () => void;
              }
            ).showPicker = originalShowPicker;
          }
          console.log("[AiIngest] doubao: click/showPicker restored");
        } catch (e) {
          console.log("[AiIngest] doubao: restore failed", e);
        }
      }
    }

    // 3. 延迟扫描新出现的 input 并挂载文件
    setTimeout(() => {
      const newInput = document.querySelector<HTMLInputElement>(
        'input[data-testid="upload-file-input"], input[type="file"]',
      );

      if (newInput && this.isValidFileInput(newInput, file)) {
        console.log(
          "[AiIngest] doubao: input appeared after click, mounting file",
        );
        this.mountFileToInput(newInput, dataTransfer);
      } else {
        console.log("[AiIngest] doubao: no valid input appeared after click", {
          found: !!newInput,
        });
      }
    }, 200);

    return true;
  }

  /**
   * 互斥式文件挂载入口
   */
  public static attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): boolean {
    const now = Date.now();
    const uploadKey = `${file.name}-${file.size}`;
    if (now - this.lastUploadTime < 1500 && this.lastUploadKey === uploadKey) {
      console.log("[AiIngest] attachVirtualFile: deduped");
      return true;
    }
    this.lastUploadTime = now;
    this.lastUploadKey = uploadKey;

    const activeEl = (
      targetElement instanceof HTMLElement
        ? targetElement
        : document.activeElement
    ) as HTMLElement | null;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const currentHost = window.location.hostname.toLowerCase();

    // 豆包专用分支
    if (currentHost.includes("doubao.com")) {
      return this.tryDoubaoUpload(file, dataTransfer);
    }

    // 其他站点：file input → paste → drop
    if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
      return true;
    }
    if (this.tryPasteEvent(activeEl, dataTransfer)) {
      return true;
    }
    if (this.tryDragAndDrop(activeEl, dataTransfer)) {
      return true;
    }

    return false;
  }

  /**
   * 轻量化文本光标注入
   */
  public static insertAtCursor(
    text: string,
    targetElement?: EventTarget | null,
    savedRange?: { start: number; end: number },
  ): boolean {
    const activeEl = (
      targetElement instanceof HTMLElement
        ? targetElement
        : document.activeElement
    ) as HTMLElement | null;

    if (!activeEl) return false;

    if (
      activeEl instanceof HTMLTextAreaElement ||
      activeEl instanceof HTMLInputElement
    ) {
      const originalValue = activeEl.value;
      const start = savedRange
        ? Math.min(savedRange.start, originalValue.length)
        : (activeEl.selectionStart ?? originalValue.length);
      const end = savedRange
        ? Math.min(savedRange.end, originalValue.length)
        : (activeEl.selectionEnd ?? originalValue.length);

      const updatedValue =
        originalValue.slice(0, start) + text + originalValue.slice(end);

      const prototype =
        activeEl instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        prototype,
        "value",
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(activeEl, updatedValue);
      } else {
        activeEl.value = updatedValue;
      }

      const newPos = start + text.length;
      try {
        activeEl.setSelectionRange(newPos, newPos);
      } catch {
        // 静默捕获
      }

      activeEl.dispatchEvent(
        new Event("input", { bubbles: true, composed: true }),
      );
      activeEl.dispatchEvent(
        new Event("change", { bubbles: true, composed: true }),
      );
      return true;
    }

    if (
      activeEl.isContentEditable ||
      activeEl.closest("[contenteditable='true']")
    ) {
      const container = activeEl.isContentEditable
        ? activeEl
        : (activeEl.closest("[contenteditable='true']") as HTMLElement);

      container.focus();

      if (typeof InputEvent === "function") {
        const inputEvent = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: "insertText",
          data: text,
        });
        const notCancelled = container.dispatchEvent(inputEvent);
        if (!notCancelled) return true;
      }

      return document.execCommand("insertText", false, text);
    }

    return false;
  }
}
