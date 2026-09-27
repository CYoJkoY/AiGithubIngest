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
   * 核心重置清理器：彻底释放物理 input 节点上的挂载，防止文件残留与重复提交
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
   * 触发后立即安排微延迟解绑，杜绝 DOM 驻留
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

          // 派发标准事件促使宿主框架（如 React/Vue）捕获并读取文件
          fileInput.dispatchEvent(
            new Event("change", { bubbles: true, composed: true }),
          );
          fileInput.dispatchEvent(
            new Event("input", { bubbles: true, composed: true }),
          );

          // 关键修复：给宿主框架 80ms 同步读取窗口，随后彻底清空物理 DOM，防止残留
          setTimeout(() => {
            UniversalEditor.cleanUpFileInput(fileInput);
          }, 80);

          return true;
        } catch {
          // 切换下一候选节点
        }
      }
    }

    return false;
  }

  /**
   * 策略 2: 剪贴板事件仿真（互斥单次消费代理 + 非冒泡穿透）
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

      const rawFiles = dataTransfer.files;
      const rawItems = dataTransfer.items;
      const emptyDT = new DataTransfer();

      let isGateOpen = true;
      let filesAccessed = false;
      let itemsAccessed = false;

      // 禁用冒泡，防止事件穿透到外层容器或 window 全局监听器导致二次上传
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: false,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer,
      });

      // 互斥单次消费代理：
      // 1. 若宿主先读取 files，则后续对 items 的读取立即屏蔽返回空
      // 2. 若宿主先读取 items，则后续对 files 的读取立即屏蔽返回空
      // 3. 彻底根除同一事件中同时消费 items 和 files 造成的双重上传
      const clipboardProxy = new Proxy(dataTransfer, {
        get(tgt, prop, receiver) {
          if (!isGateOpen) {
            if (prop === "files") return emptyDT.files;
            if (prop === "items") return emptyDT.items;
            if (prop === "types") return [];
            if (prop === "getData") return () => "";
          }

          if (prop === "files") {
            if (itemsAccessed) {
              return emptyDT.files;
            }
            filesAccessed = true;
            return rawFiles;
          }

          if (prop === "items") {
            if (filesAccessed) {
              return emptyDT.items;
            }
            itemsAccessed = true;

            let fileExtracted = false;
            return new Proxy(rawItems, {
              get(itemsTgt, itemProp, itemReceiver) {
                const itemVal = Reflect.get(itemsTgt, itemProp, itemReceiver);
                if (typeof itemProp === "string" && !isNaN(Number(itemProp))) {
                  const originalItem = rawItems[Number(itemProp)];
                  if (originalItem && originalItem.kind === "file") {
                    return new Proxy(originalItem, {
                      get(fileItemTgt, fileItemProp) {
                        if (fileItemProp === "getAsFile") {
                          return () => {
                            if (fileExtracted) return null;
                            fileExtracted = true;
                            return originalItem.getAsFile();
                          };
                        }
                        const val = Reflect.get(fileItemTgt, fileItemProp);
                        return typeof val === "function"
                          ? val.bind(fileItemTgt)
                          : val;
                      },
                    });
                  }
                }
                return typeof itemVal === "function"
                  ? itemVal.bind(itemsTgt)
                  : itemVal;
              },
            });
          }

          const val = Reflect.get(tgt, prop, receiver);
          return typeof val === "function" ? val.bind(tgt) : val;
        },
      });

      try {
        Object.defineProperty(pasteEvent, "clipboardData", {
          get: () => clipboardProxy,
          configurable: true,
        });
      } catch {
        // 忽略受限环境
      }

      target.dispatchEvent(pasteEvent);

      // 微任务周期内迅速关门，阻止任何异步宏任务（如 50ms setTimeout）二次读取
      queueMicrotask(() => {
        isGateOpen = false;
        try {
          dataTransfer.items.clear();
        } catch {
          // 忽略
        }
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 策略 3: 拖拽仿真
   */
  private static tryDragAndDrop(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    const candidateTargets = [
      activeEl,
      activeEl?.closest('[class*="chat"]'),
      activeEl?.closest('[class*="input"]'),
      activeEl?.closest('[class*="editor"]'),
      document.querySelector('[data-dropzone="true"]'),
      document.querySelector('[class*="dropzone"]'),
      document.querySelector('[class*="drop-target"]'),
      document.querySelector('[role="main"]'),
      document.querySelector("main"),
      document.body,
    ].filter((el): el is HTMLElement => Boolean(el));

    if (candidateTargets.length === 0) return false;

    try {
      const eventInit: DragEventInit = {
        bubbles: false,
        cancelable: true,
        composed: true,
        dataTransfer,
      };

      for (const target of candidateTargets) {
        const dragEnter = new DragEvent("dragenter", eventInit);
        const dragOver = new DragEvent("dragover", eventInit);
        const drop = new DragEvent("drop", eventInit);

        target.dispatchEvent(dragEnter);
        target.dispatchEvent(dragOver);
        target.dispatchEvent(drop);
      }

      queueMicrotask(() => {
        try {
          dataTransfer.items.clear();
        } catch {
          // 忽略
        }
      });

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

    // 豆包平台优先使用带有单次互斥时钟门的 Paste 策略
    if (currentHost.includes("doubao.com")) {
      if (this.tryPasteEvent(activeEl, dataTransfer)) {
        return true;
      }
    }

    // 优先策略 1: 扫描并触发 input[type="file"]（自带 80ms 自动解绑机制）
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
