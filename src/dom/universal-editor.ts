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
   *
   * 关键难点与最终解决方案：
   *
   *   诊断日志证明：豆包不是通过 HTMLInputElement.prototype.click() 打开
   *   文件选择器（否则我们的 prototype patch 会命中并打印 suppressed 日志），
   *   也不是通过 showPicker()。它走的是**直接向 input 元素派发 click 事件**
   *   （input.dispatchEvent(new MouseEvent('click')) 或类似），
   *   浏览器识别为 trusted click 后弹出系统文件选择器，绕过所有 prototype 方法。
   *
   *   解决方案：在 document 上以**捕获阶段**监听 click 事件，一旦发现事件
   *   目标是 type="file" 的 input，立即 preventDefault + stopImmediatePropagation，
   *   阻止浏览器的默认"打开文件选择器"行为。
   *
   *   捕获阶段在 document 上，会先于豆包任何监听器执行，因此 100% 拦截。
   *   拦截窗口为 1 秒，覆盖豆包所有同步 + 异步的 click 派发。
   *   1 秒后自动移除拦截器，用户后续手动操作完全正常。
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

    // 2. 慢路径：安装 click 捕获拦截器 → 派发 click → 挂载文件
    const attachBtn = document.querySelector<HTMLElement>(
      'button[data-testid="upload_file_button"]',
    );

    if (!attachBtn) {
      console.log("[AiIngest] doubao: no attach button found");
      return false;
    }

    // 安装捕获阶段的 click 拦截器：阻止浏览器弹出系统文件选择器
    // 只拦截 input[type="file"] 上的 click，不影响其他元素
    const clickBlocker = (e: Event): void => {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === "file") {
        console.log(
          "[AiIngest] doubao: blocked click on file input (capture phase)",
        );
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener("click", clickBlocker, true);

    // 兼容 patch：也拦截 showPicker（部分 Chrome 版本会走这条路径）
    const originalShowPicker = (
      HTMLInputElement.prototype as unknown as {
        showPicker?: () => void;
      }
    ).showPicker;
    let showPickerPatched = false;

    if (typeof originalShowPicker === "function") {
      try {
        (
          HTMLInputElement.prototype as unknown as {
            showPicker: () => void;
          }
        ).showPicker = function (this: HTMLInputElement): void {
          if (this.type === "file") {
            console.log("[AiIngest] doubao: blocked showPicker on file input");
            return;
          }
          return originalShowPicker.call(this);
        };
        showPickerPatched = true;
      } catch (e) {
        console.log("[AiIngest] doubao: showPicker patch failed", e);
      }
    }

    console.log("[AiIngest] doubao: click blocker installed");

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

    // 4. 1 秒后移除拦截器和恢复 patch，保证用户后续操作完全正常
    setTimeout(() => {
      try {
        document.removeEventListener("click", clickBlocker, true);
        if (showPickerPatched) {
          (
            HTMLInputElement.prototype as unknown as {
              showPicker?: () => void;
            }
          ).showPicker = originalShowPicker;
        }
        console.log("[AiIngest] doubao: click blocker removed (after 1s)");
      } catch (e) {
        console.log("[AiIngest] doubao: cleanup failed", e);
      }
    }, 1000);

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
