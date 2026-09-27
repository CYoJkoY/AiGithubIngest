export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = "";
  private static isUploading = false;

  /**
   * 校验 file input 是否具备接收文本/文档附件的能力
   * 采用宽松防御策略：只要不是明确仅限图片/音视频的专用控件，均允许挂载 Markdown
   */
  private static isValidFileInput(
    input: HTMLInputElement,
    file: File,
  ): boolean {
    if (input.disabled) return false;
    const accept = input.accept?.trim();
    if (!accept) return true;

    const acceptLower = accept.toLowerCase();

    // 排除明确仅接受图片、音频、视频的专用控件（如头像上传、语音输入）
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
   * 查找页面中可能存在的附件上传按钮并尝试唤起隐藏的 input
   */
  private static tryWakeUploadInput(): void {
    const uploadBtnSelectors = [
      'button[aria-label*="上传"]',
      'button[aria-label*="文件"]',
      'button[aria-label*="附件"]',
      'button[title*="上传"]',
      'button[title*="文件"]',
      'button[title*="附件"]',
      'div[role="button"][aria-label*="上传"]',
      'div[role="button"][title*="上传"]',
      'button[aria-label*="upload" i]',
      'button[aria-label*="attach" i]',
      'button[aria-label*="file" i]',
      'button[title*="upload" i]',
      'button[title*="attach" i]',
      'button[title*="file" i]',
      'div[role="button"][aria-label*="upload" i]',
      'div[role="button"][aria-label*="attach" i]',
      'div[role="button"][title*="upload" i]',
      'div[role="button"][title*="attach" i]',
      '[class*="upload-btn"]',
      '[class*="attach-btn"]',
    ];

    for (const selector of uploadBtnSelectors) {
      const btn = document.querySelector<HTMLElement>(selector);
      if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
        btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        break;
      }
    }
  }

  /**
   * 策略 1: 扫描并触发原生 input[type="file"] 挂载
   * 针对豆包设立 document 冒泡屏障，允许通过 #root 委托，但阻止渗透至 window
   */
  private static tryUploadViaFileInput(
    file: File,
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    this.tryWakeUploadInput();

    const currentHost = window.location.hostname.toLowerCase();
    const isDoubao = currentHost.includes("doubao.com");

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

    // 跨作用域去重收集候选控件，杜绝多重 scope 重复扫描相同控件
    const seenInputs = new Set<HTMLInputElement>();
    const candidateInputs: HTMLInputElement[] = [];

    for (const scope of searchScopes) {
      const fileInputs = Array.from(
        scope.querySelectorAll<HTMLInputElement>('input[type="file"]'),
      );
      for (const input of fileInputs) {
        if (!seenInputs.has(input) && this.isValidFileInput(input, file)) {
          seenInputs.add(input);
          candidateInputs.push(input);
        }
      }
    }

    if (candidateInputs.length === 0) return false;

    // 优先级排序：专属于 Markdown/文档的控件 > 离当前输入框最近的控件 > 可见控件
    candidateInputs.sort((a, b) => {
      const aAccept = (a.accept || "").toLowerCase();
      const bAccept = (b.accept || "").toLowerCase();
      const aExplicitMd =
        aAccept.includes(".md") ||
        aAccept.includes("markdown") ||
        aAccept.includes("text");
      const bExplicitMd =
        bAccept.includes(".md") ||
        bAccept.includes("markdown") ||
        bAccept.includes("text");

      if (aExplicitMd && !bExplicitMd) return -1;
      if (!aExplicitMd && bExplicitMd) return 1;

      if (activeEl) {
        const aNear = Boolean(
          a.closest('[class*="input"]') || a.closest('[class*="chat"]'),
        );
        const bNear = Boolean(
          b.closest('[class*="input"]') || b.closest('[class*="chat"]'),
        );
        if (aNear && !bNear) return -1;
        if (!aNear && bNear) return 1;
      }

      const aVisible = a.offsetWidth > 0 || a.offsetHeight > 0;
      const bVisible = b.offsetWidth > 0 || b.offsetHeight > 0;
      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;

      return 0;
    });

    const fileInput = candidateInputs[0];

    // 冒泡屏障：在 document 层停止冒泡，阻止事件穿透到全局 window
    const stopBubbleAtDocument = (e: Event): void => {
      e.stopPropagation();
    };

    try {
      try {
        fileInput.value = "";
      } catch {
        // 部分浏览器受限属性设空静默忽略
      }

      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files",
      );

      if (descriptor?.set) {
        descriptor.set.call(fileInput, dataTransfer.files);
      } else {
        fileInput.files = dataTransfer.files;
      }

      const tracker = (
        fileInput as unknown as {
          _valueTracker?: { setValue: (val: string) => void };
        }
      )._valueTracker;
      if (tracker) {
        tracker.setValue("");
      }

      if (isDoubao) {
        document.addEventListener("change", stopBubbleAtDocument, {
          capture: false,
          once: true,
        });
      }

      fileInput.dispatchEvent(
        new Event("change", { bubbles: true, composed: true }),
      );

      return true;
    } catch {
      return false;
    } finally {
      if (isDoubao) {
        document.removeEventListener("change", stopBubbleAtDocument, false);
      }
    }
  }

  /**
   * 策略 2: 单靶向精准模拟 ClipboardEvent('paste') 携带 File 对象
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

    const currentHost = window.location.hostname.toLowerCase();
    const isDoubao = currentHost.includes("doubao.com");

    const stopBubbleAtDocument = (e: Event): void => {
      e.stopPropagation();
    };

    try {
      target.focus();

      if (isDoubao) {
        document.addEventListener("paste", stopBubbleAtDocument, {
          capture: false,
          once: true,
        });
      }

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer,
      });

      target.dispatchEvent(pasteEvent);
      return true;
    } catch {
      return false;
    } finally {
      if (isDoubao) {
        document.removeEventListener("paste", stopBubbleAtDocument, false);
      }
    }
  }

  /**
   * 策略 3: 精准单靶心 Drag & Drop 状态机仿真
   */
  private static tryDragAndDrop(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    const target =
      (activeEl instanceof HTMLElement ? activeEl : null) ||
      (document.querySelector(
        'textarea, [contenteditable="true"], [role="textbox"]',
      ) as HTMLElement | null) ||
      document.querySelector<HTMLElement>('[data-dropzone="true"]') ||
      document.querySelector<HTMLElement>('[class*="dropzone"]') ||
      (activeEl?.closest("form") as HTMLElement | null) ||
      (activeEl?.closest('[class*="chat"]') as HTMLElement | null);

    if (!target) return false;

    const currentHost = window.location.hostname.toLowerCase();
    const isDoubao = currentHost.includes("doubao.com");

    const stopBubbleAtDocument = (e: Event): void => {
      e.stopPropagation();
    };

    try {
      if (isDoubao) {
        document.addEventListener("drop", stopBubbleAtDocument, {
          capture: false,
          once: true,
        });
      }

      const eventInit: DragEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer,
      };

      target.dispatchEvent(new DragEvent("dragenter", eventInit));
      target.dispatchEvent(new DragEvent("dragover", eventInit));
      target.dispatchEvent(new DragEvent("drop", eventInit));
      return true;
    } catch {
      return false;
    } finally {
      if (isDoubao) {
        document.removeEventListener("drop", stopBubbleAtDocument, false);
      }
    }
  }

  /**
   * 互斥式文件挂载入口：增加 1500ms 任务指纹锁与并发锁
   */
  public static attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): boolean {
    const now = Date.now();
    const uploadKey = `${file.name}-${file.size}`;

    if (this.isUploading) return true;
    if (now - this.lastUploadTime < 1500 && this.lastUploadKey === uploadKey) {
      return true;
    }

    this.isUploading = true;
    this.lastUploadTime = now;
    this.lastUploadKey = uploadKey;

    try {
      const activeEl = (
        targetElement instanceof HTMLElement
          ? targetElement
          : document.activeElement
      ) as HTMLElement | null;

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const currentHost = window.location.hostname.toLowerCase();
      const isDoubao = currentHost.includes("doubao.com");

      if (isDoubao) {
        // 豆包平台优先使用单靶向 input 挂载（带 document 冒泡屏障）
        if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
          return true;
        }
        if (this.tryPasteEvent(activeEl, dataTransfer)) {
          return true;
        }
        if (this.tryDragAndDrop(activeEl, dataTransfer)) {
          return true;
        }
      } else {
        // 其他主流平台执行标准级联
        if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
          return true;
        }
        if (this.tryPasteEvent(activeEl, dataTransfer)) {
          return true;
        }
        if (this.tryDragAndDrop(activeEl, dataTransfer)) {
          return true;
        }
      }

      return false;
    } finally {
      setTimeout(() => {
        this.isUploading = false;
      }, 500);
    }
  }

  /**
   * 轻量化文本光标注入（降级兜底通道）
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

    // 1. Textarea / Input 元素
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

    // 2. contenteditable 富文本输入容器
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
