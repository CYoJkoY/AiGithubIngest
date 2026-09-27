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
   * 策略 2: 剪贴板事件仿真（豆包最终修复版）
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
   * 修复策略（三重保险）：
   *
   *   1. 覆盖实例属性：不使用 ClipboardEvent 构造函数的 clipboardData 选项
   *      （该选项在部分 Chrome 版本 / MV3 content script 环境下会被忽略，
   *      导致 pasteEvent.clipboardData 为 null），改为在实例上直接
   *      Object.defineProperty 覆盖，保证 getter 一定被使用。
   *
   *   2. 一次性交付代理：把 clipboardData 替换为 Object.create(DataTransfer.prototype, ...)
   *      的代理对象。files / items 共享同一个 delivered 标志：第一次读取返回真实
   *      FileList / DataTransferItemList，后续读取返回空列表。这解决了"同步多次读取"
   *      的场景（React 分发给多个同步 onPaste handler）。
   *
   *   3. 底层清空：dispatchEvent 同步返回后，立即调用 dataTransfer.items.clear()，
   *      并在微任务与宏任务阶段再各清空一次。这解决了"异步多次读取"的场景
   *      （某些 handler 会在 dispatchEvent 之后通过 setTimeout / Promise 再读一次）。
   *      已经同步读到 File 引用的 handler 不受影响，因为它们的引用是快照。
   *
   *   最终效果：第一个 handler 读到真实文件 → 正常上传 1 次；
   *   其余 handler 无论同步还是异步，均读到空列表 → 静默跳过。
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

      // 快照真实数据与空数据
      const realFiles = dataTransfer.files;
      const realItems = dataTransfer.items;
      const emptyDataTransfer = new DataTransfer();
      const emptyFiles = emptyDataTransfer.files;
      const emptyItems = emptyDataTransfer.items;

      // files 与 items 共享一个"已交付"标志：无论哪个先被读取，
      // 只有第一个读取者能拿到真实数据。
      let delivered = false;
      const consume = <T>(real: T, empty: T): T => {
        if (delivered) return empty;
        delivered = true;
        return real;
      };

      // 用 PropertyDescriptorMap 断言避免 TS 对字面量联合类型（如 dropEffect）
      // 的 setter 参数做窄化校验；同时不提供 setter，避免写入冲突。
      const proxyDescriptorMap = {
        files: {
          configurable: true,
          get: () => consume(realFiles, emptyFiles),
        },
        items: {
          configurable: true,
          get: () => consume(realItems, emptyItems),
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

      // 用 Object.create 保留 DataTransfer 原型链，
      // 使代理对象 instanceof DataTransfer 仍然成立。
      const clipboardProxy = Object.create(
        DataTransfer.prototype,
        proxyDescriptorMap,
      );

      // 关键：不使用构造函数的 clipboardData 选项，避免在某些环境下被忽略，
      // 导致 pasteEvent.clipboardData 为 null。
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
      });

      // 直接在实例上覆盖 clipboardData 属性
      try {
        Object.defineProperty(pasteEvent, "clipboardData", {
          configurable: true,
          get() {
            return clipboardProxy;
          },
        });
      } catch {
        // 极端环境下若禁止重定义，退回构造函数选项
        try {
          Object.defineProperty(pasteEvent, "clipboardData", {
            configurable: true,
            value: dataTransfer,
          });
        } catch {
          // 彻底失败则保持为 null（此时豆包会读空）
        }
      }

      // 关键：不做任何冒泡阻断，让 React 合成事件系统正常分发。
      target.dispatchEvent(pasteEvent);

      // dispatchEvent 同步返回后，所有同步 handler 已执行完毕。
      // 立即清空底层 dataTransfer 的 items，阻止任何异步 handler 再次读取。
      // 已经同步读到 File 引用的 handler 不受影响（它们的引用是快照）。
      try {
        dataTransfer.items.clear();
      } catch {
        /* no-op */
      }

      // 微任务阶段再清一次，兜底 Promise.then 中的读取
      queueMicrotask(() => {
        try {
          dataTransfer.items.clear();
        } catch {
          /* no-op */
        }
      });

      // 宏任务阶段再清一次，兜底 setTimeout(0) 中的读取
      setTimeout(() => {
        try {
          dataTransfer.items.clear();
        } catch {
          /* no-op */
        }
      }, 0);

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
    // 直接走修复后的 paste 策略（不阻断冒泡，改用一次性 files 交付 +
    // dispatch 后清空底层 DataTransfer，防止 React 合成事件层被多个 onPaste
    // 处理器重复消费）。
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
