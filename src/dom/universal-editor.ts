export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = "";

  /**
   * 校验 file input 是否具备接收文本/文档附件的能力
   * 采用宽松防御策略：只要不是明确仅限图片/音视频的输入框，均允许挂载 Markdown
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
   * 清理并解绑物理 input 节点上的文件常驻状态，防止文件持续悬挂导致后续操作重复提交
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
   * 策略 1: 扫描并触发原生 input[type="file"] 挂载
   */
  private static tryUploadViaFileInput(
    file: File,
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    this.tryWakeUploadInput();

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

        try {
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

          fileInput.dispatchEvent(
            new Event("change", { bubbles: true, composed: true }),
          );
          fileInput.dispatchEvent(
            new Event("input", { bubbles: true, composed: true }),
          );

          // 留出 300ms 异步读取窗口，随后清空物理 DOM 节点，防止发送后文件常驻挂载
          setTimeout(() => {
            UniversalEditor.cleanUpFileInput(fileInput);
          }, 300);

          return true;
        } catch {
          // 切换下一候选节点
        }
      }
    }

    return false;
  }

  /**
   * 策略 2: 剪贴板事件仿真（关键修复版）
   *
   * 背景：豆包输入框是 tiptap / ProseMirror contenteditable，页面没有
   * 任何 input[type="file"]。一次合成的 paste 事件会被 React 的合成
   * 事件系统分发给组件树中多个 onPaste 处理器，每个处理器都会读取
   * event.clipboardData.files 并各自触发一次文件上传，表现为"上传两个
   * 相同文件"。
   *
   * 修复思路：
   *   劫持派发出去的 ClipboardEvent.clipboardData，将 files 暴露为一个
   *   一次性 getter —— 第一次读取返回真实 FileList，之后返回空 FileList。
   *   这样：
   *     - 第一个 onPaste 处理器读到真实文件 → 正常上传一次
   *     - 第二个 onPaste 处理器读到空文件列表 → 静默跳过，不再重复上传
   *
   * 保留在 target 自身注册冒泡阶段的 stopPropagation 监听器，进一步
   * 防止合成事件冒泡到 window / document 上的全局粘贴监听器。
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

      // 快照真实文件列表，并准备一个空的 FileList 作为"已消耗"返回值
      const realFiles = dataTransfer.files;
      const emptyFiles = new DataTransfer().files;
      let filesReadCount = 0;

      // 构造一份代理 clipboardData：转发 DataTransfer 全部能力，
      // 仅在 files 属性上做一次性消耗语义。
      const clipboardProxy = {
        get items() {
          return dataTransfer.items;
        },
        get types() {
          return dataTransfer.types;
        },
        get dropEffect() {
          return dataTransfer.dropEffect;
        },
        get effectAllowed() {
          return dataTransfer.effectAllowed;
        },
        getData: (format: string) => dataTransfer.getData(format),
        setData: (format: string, data: string) =>
          dataTransfer.setData(format, data),
        clearData: (format?: string) => dataTransfer.clearData(format),
        setDragImage: () => {
          /* no-op */
        },
      };

      Object.defineProperty(clipboardProxy, "files", {
        configurable: true,
        get() {
          filesReadCount += 1;
          return filesReadCount === 1 ? realFiles : emptyFiles;
        },
      });

      // 先按标准方式构造 ClipboardEvent，再用 defineProperty 把 clipboardData
      // 劫持为上面的代理对象，让所有监听器（React 合成事件层 + 原生层）都
      // 拿到同一个代理，共享 files 的"一次性"语义。
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer,
      });

      try {
        Object.defineProperty(pasteEvent, "clipboardData", {
          configurable: true,
          get() {
            return clipboardProxy;
          },
          set() {
            /* 忽略框架内部对 clipboardData 的重新赋值 */
          },
        });
      } catch {
        // 某些运行环境禁止重定义，忽略并退回原始 dataTransfer
      }

      // 在 target 自身注册冒泡阶段的停止传播监听器，
      // 让事件不再冒泡到 window / document 的全局粘贴监听器。
      const stopAtTarget = (e: Event): void => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      target.addEventListener("paste", stopAtTarget, false);

      try {
        target.dispatchEvent(pasteEvent);
      } finally {
        target.removeEventListener("paste", stopAtTarget, false);
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 策略 3: 单靶向 Drag & Drop 状态机仿真
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
   * 互斥式文件挂载入口
   */
  public static attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): boolean {
    const now = Date.now();
    const uploadKey = `${file.name}-${file.size}`;
    if (now - this.lastUploadTime < 1500 && this.lastUploadKey === uploadKey) {
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

    // 豆包：输入框为 ProseMirror contenteditable，页面无任何 input[type="file"]。
    // 直接走修复后的 paste 策略（在 target 上拦截冒泡防止 React 委托二次消费）。
    if (currentHost.includes("doubao.com")) {
      if (this.tryPasteEvent(activeEl, dataTransfer)) {
        return true;
      }
      // 兜底：万一未来豆包版本引入了 file input
      if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
        return true;
      }
      return false;
    }

    // 其他站点：优先策略 1: 扫描并触发 input[type="file"]
    if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
      return true;
    }

    // 优先策略 2: 模拟粘贴 ClipboardEvent
    if (this.tryPasteEvent(activeEl, dataTransfer)) {
      return true;
    }

    // 优先策略 3: 模拟拖拽 Drag & Drop
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
