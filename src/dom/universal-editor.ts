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
        console.log("[AiIngest] tryWakeUploadInput matched:", selector);
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
      console.log("[AiIngest] cleanUpFileInput done");
    } catch (e) {
      console.log("[AiIngest] cleanUpFileInput failed:", e);
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
    console.log("[AiIngest] tryUploadViaFileInput enter");
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

      if (fileInputs.length > 0) {
        console.log(
          "[AiIngest] scope has file inputs:",
          scope.tagName,
          scope.className,
          "count =",
          fileInputs.length,
        );
      }

      for (const fileInput of fileInputs) {
        const valid = this.isValidFileInput(fileInput, file);
        console.log("[AiIngest] candidate input:", {
          accept: fileInput.accept,
          multiple: fileInput.multiple,
          disabled: fileInput.disabled,
          hidden: fileInput.offsetParent === null,
          valid,
        });
        if (!valid) continue;

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

          console.log("[AiIngest] dispatching change + input on input");
          fileInput.dispatchEvent(
            new Event("change", { bubbles: true, composed: true }),
          );
          fileInput.dispatchEvent(
            new Event("input", { bubbles: true, composed: true }),
          );

          setTimeout(() => {
            UniversalEditor.cleanUpFileInput(fileInput);
          }, 300);

          return true;
        } catch (e) {
          console.log("[AiIngest] tryUploadViaFileInput candidate failed:", e);
        }
      }
    }

    console.log("[AiIngest] tryUploadViaFileInput return false");
    return false;
  }

  /**
   * 策略 2: 剪贴板事件仿真（豆包关键修复版 + 诊断日志）
   *
   * 背景与实测：
   *   - 豆包输入框是 tiptap / ProseMirror contenteditable，页面没有任何
   *     input[type="file"]。
   *   - 一次合成的 paste 事件会被 React 合成事件系统分发给组件树中多个
   *     onPaste 处理器，每个处理器都会读取 event.clipboardData.files 并各自
   *     触发一次文件上传，表现为"上传两个相同文件"。
   *   - 一旦在 target 上 stopPropagation / stopImmediatePropagation，React
   *     合成事件层直接收不到 paste 事件，表现为"0 个文件上传"。
   *     所以绝不能阻断冒泡。
   *
   * 修复策略（三重保险 + 日志）：
   *   1. 覆盖实例属性：Object.defineProperty 覆盖 pasteEvent.clipboardData。
   *   2. 一次性交付代理：files / items 共享 delivered 标志，只放行第一次读取。
   *   3. 底层清空：dispatchEvent 后同步 + microtask + macrotask 三阶段清空
   *      dataTransfer.items，阻断异步二次读取。
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

    if (!target) {
      console.log("[AiIngest] tryPasteEvent: no target found");
      return false;
    }

    console.log("[AiIngest] tryPasteEvent enter, target =", {
      tag: target.tagName,
      className: target.className,
      id: target.id,
    });

    try {
      target.focus();

      // 快照真实数据与空数据
      const realFiles = dataTransfer.files;
      const realItems = dataTransfer.items;
      const emptyDataTransfer = new DataTransfer();
      const emptyFiles = emptyDataTransfer.files;
      const emptyItems = emptyDataTransfer.items;

      console.log(
        "[AiIngest] snapshot: realFiles.length =",
        realFiles.length,
        "realItems.length =",
        realItems.length,
      );

      // 诊断计数器
      let filesReadCount = 0;
      let itemsReadCount = 0;

      // files 与 items 共享一个"已交付"标志
      let delivered = false;
      const consume = <T>(
        real: T,
        empty: T,
        label: string,
        count: number,
      ): T => {
        if (delivered) {
          console.log(`[AiIngest] consume(${label}) #${count} -> EMPTY`);
          return empty;
        }
        delivered = true;
        console.log(`[AiIngest] consume(${label}) #${count} -> REAL`);
        return real;
      };

      const proxyDescriptorMap = {
        files: {
          configurable: true,
          get: () => {
            filesReadCount += 1;
            const stack = new Error().stack;
            console.log(
              `[AiIngest] clipboardData.files read #${filesReadCount}`,
              stack,
            );
            return consume(realFiles, emptyFiles, "files", filesReadCount);
          },
        },
        items: {
          configurable: true,
          get: () => {
            itemsReadCount += 1;
            const stack = new Error().stack;
            console.log(
              `[AiIngest] clipboardData.items read #${itemsReadCount}`,
              stack,
            );
            return consume(realItems, emptyItems, "items", itemsReadCount);
          },
        },
        types: {
          configurable: true,
          get: () => dataTransfer.types,
        },
        dropEffect: {
          configurable: true,
          get: () => dataTransfer.dropEffect,
        },
        effectAllowed: {
          configurable: true,
          get: () => dataTransfer.effectAllowed,
        },
        getData: {
          configurable: true,
          value: (format: string) => dataTransfer.getData(format),
        },
        setData: {
          configurable: true,
          value: (format: string, data: string) =>
            dataTransfer.setData(format, data),
        },
        clearData: {
          configurable: true,
          value: (format?: string) => dataTransfer.clearData(format),
        },
        setDragImage: {
          configurable: true,
          value: () => undefined,
        },
      } as PropertyDescriptorMap;

      const clipboardProxy = Object.create(
        DataTransfer.prototype,
        proxyDescriptorMap,
      );

      // 不使用构造函数选项，避免被忽略
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });

      try {
        Object.defineProperty(pasteEvent, "clipboardData", {
          configurable: true,
          get() {
            console.log(
              "[AiIngest] pasteEvent.clipboardData getter accessed, returning proxy",
            );
            return clipboardProxy;
          },
        });
        console.log("[AiIngest] clipboardData proxy installed on event");
      } catch (e) {
        console.log("[AiIngest] defineProperty clipboardData failed:", e);
        try {
          Object.defineProperty(pasteEvent, "clipboardData", {
            configurable: true,
            value: dataTransfer,
          });
          console.log("[AiIngest] fallback to raw dataTransfer value");
        } catch (e2) {
          console.log("[AiIngest] fallback also failed:", e2);
        }
      }

      console.log("[AiIngest] === dispatching paste event ===");
      target.dispatchEvent(pasteEvent);
      console.log(
        "[AiIngest] === dispatch done ===",
        "filesRead =",
        filesReadCount,
        "itemsRead =",
        itemsReadCount,
        "delivered =",
        delivered,
      );

      // dispatchEvent 同步返回后立即清空底层 items
      try {
        dataTransfer.items.clear();
        console.log("[AiIngest] cleared dataTransfer.items (sync)");
      } catch (e) {
        console.log("[AiIngest] sync clear failed:", e);
      }

      queueMicrotask(() => {
        try {
          dataTransfer.items.clear();
          console.log("[AiIngest] cleared dataTransfer.items (microtask)");
        } catch (e) {
          console.log("[AiIngest] microtask clear failed:", e);
        }
      });

      setTimeout(() => {
        try {
          dataTransfer.items.clear();
          console.log("[AiIngest] cleared dataTransfer.items (macrotask)");
        } catch (e) {
          console.log("[AiIngest] macrotask clear failed:", e);
        }
      }, 0);

      return true;
    } catch (e) {
      console.log("[AiIngest] tryPasteEvent threw:", e);
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

    if (!candidateTarget) {
      console.log("[AiIngest] tryDragAndDrop: no candidate target");
      return false;
    }

    try {
      const eventInit: DragEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer,
      };

      console.log("[AiIngest] tryDragAndDrop dispatching on", candidateTarget);
      candidateTarget.dispatchEvent(new DragEvent("dragenter", eventInit));
      candidateTarget.dispatchEvent(new DragEvent("dragover", eventInit));
      candidateTarget.dispatchEvent(new DragEvent("drop", eventInit));

      return true;
    } catch (e) {
      console.log("[AiIngest] tryDragAndDrop threw:", e);
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
    console.log("[AiIngest] attachVirtualFile called:", {
      name: file.name,
      size: file.size,
      type: file.type,
    });

    const now = Date.now();
    const uploadKey = `${file.name}-${file.size}`;
    if (now - this.lastUploadTime < 1500 && this.lastUploadKey === uploadKey) {
      console.log("[AiIngest] attachVirtualFile: deduped (same file < 1500ms)");
      return true;
    }
    this.lastUploadTime = now;
    this.lastUploadKey = uploadKey;

    const activeEl = (
      targetElement instanceof HTMLElement
        ? targetElement
        : document.activeElement
    ) as HTMLElement | null;

    console.log("[AiIngest] activeEl =", {
      tag: activeEl?.tagName,
      className: activeEl?.className,
      id: activeEl?.id,
    });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    console.log(
      "[AiIngest] dataTransfer.items.length after add =",
      dataTransfer.items.length,
    );

    const currentHost = window.location.hostname.toLowerCase();
    console.log("[AiIngest] currentHost =", currentHost);

    // 豆包分支
    if (currentHost.includes("doubao.com")) {
      console.log("[AiIngest] doubao branch: tryPasteEvent first");
      if (this.tryPasteEvent(activeEl, dataTransfer)) {
        console.log("[AiIngest] doubao branch: tryPasteEvent returned true");
        return true;
      }
      console.log("[AiIngest] doubao branch: tryPasteEvent failed, fallback");
      if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
        return true;
      }
      return false;
    }

    // 其他站点
    if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
      console.log("[AiIngest] non-doubao: tryUploadViaFileInput succeeded");
      return true;
    }
    if (this.tryPasteEvent(activeEl, dataTransfer)) {
      console.log("[AiIngest] non-doubao: tryPasteEvent succeeded");
      return true;
    }
    if (this.tryDragAndDrop(activeEl, dataTransfer)) {
      console.log("[AiIngest] non-doubao: tryDragAndDrop succeeded");
      return true;
    }

    console.log("[AiIngest] attachVirtualFile: all strategies failed");
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
