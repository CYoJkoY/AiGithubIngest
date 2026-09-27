export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = "";

  /**
   * 重置并解绑指定 input[type="file"]，清除物理挂载的文件缓存与跟踪状态
   */
  private static cleanUpFileInput(fileInput: HTMLInputElement): void {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files",
      );
      const emptyDT = new DataTransfer();
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
      // 忽略受保护 DOM 节点的异常
    }
  }

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
   * 兼顾中英文界面的 aria-label 与 title 属性
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
   * 并在框架消费后自动解绑物理 DOM，切断长期驻留引发的二次上传或残留问题
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
          // 通过原型链 Setter 绕过 React 受控组件拦截
          const descriptor = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "files",
          );

          if (descriptor?.set) {
            descriptor.set.call(fileInput, dataTransfer.files);
          } else {
            fileInput.files = dataTransfer.files;
          }

          // 同步重置 React 内部 valueTracker
          const tracker = (
            fileInput as unknown as {
              _valueTracker?: { setValue: (val: string) => void };
            }
          )._valueTracker;
          if (tracker) {
            tracker.setValue("");
          }

          // 派发标准输入与变更事件，供宿主框架捕获同步
          fileInput.dispatchEvent(
            new Event("input", { bubbles: true, composed: true }),
          );
          fileInput.dispatchEvent(
            new Event("change", { bubbles: true, composed: true }),
          );

          // 核心修复：宿主框架在当前同步/微任务中读取文件后，80ms 后清除物理 DOM 引用
          // 彻底阻断表单提交、失焦校验或发送按钮重新扫描时的二次重复上传，并消除残留
          setTimeout(() => {
            this.cleanUpFileInput(fileInput);
          }, 80);

          return true;
        } catch {
          // 遇到受限 DOM 节点静默切换下一候选
        }
      }
    }

    return false;
  }

  /**
   * 策略 2: 单靶向精准模拟 ClipboardEvent('paste')
   * 禁止冒泡穿透至 window 外部全局监听器，并在微任务生命周期关闭时钟门
   */
  private static tryPasteEvent(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    const target =
      (activeEl?.isContentEditable
        ? (activeEl.closest('[contenteditable="true"]') as HTMLElement) ||
          activeEl
        : activeEl) ||
      (document.querySelector(
        '[contenteditable="true"], textarea, [role="textbox"]',
      ) as HTMLElement | null);

    if (!target) return false;

    try {
      target.focus();

      const rawFiles = dataTransfer.files;
      const rawItems = dataTransfer.items;
      const emptyDT = new DataTransfer();

      // 核心修复：将 bubbles 设置为 false，禁止合成事件向外部 Form/Window 冒泡，
      // 防止宿主在全局注册的后备 paste 监听器二次捕获同一份剪贴板文件
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: false,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer,
      });

      let isGateOpen = true;
      const internalClipboardData =
        (pasteEvent as unknown as { clipboardData?: DataTransfer })
          .clipboardData || dataTransfer;

      // 第一道防线：直接代理 event.clipboardData 自身
      try {
        const clipboardProxy = new Proxy(internalClipboardData, {
          get(tgt, prop, receiver) {
            if (!isGateOpen) {
              if (prop === "files") return emptyDT.files;
              if (prop === "items") return emptyDT.items;
              if (prop === "getData") return () => "";
            }
            const val = Reflect.get(tgt, prop, receiver);
            return typeof val === "function" ? val.bind(tgt) : val;
          },
        });

        Object.defineProperty(pasteEvent, "clipboardData", {
          get: () => clipboardProxy,
          configurable: true,
        });
      } catch {
        // 环境受限时静默跳过
      }

      // 第二道防线：防止部分框架在初次访问后持久缓存引用
      try {
        Object.defineProperty(internalClipboardData, "files", {
          get: () => {
            if (!isGateOpen) return emptyDT.files;
            return rawFiles;
          },
          configurable: true,
        });

        Object.defineProperty(internalClipboardData, "items", {
          get: () => {
            if (!isGateOpen) return emptyDT.items;
            return rawItems;
          },
          configurable: true,
        });
      } catch {
        // 忽略非配置属性异常
      }

      // 同步派发目标事件
      target.dispatchEvent(pasteEvent);

      // 派发后迅速在 10ms 内关死阀门并清空数据容器，防止异步宏任务重新回读
      setTimeout(() => {
        isGateOpen = false;
        try {
          dataTransfer.items.clear();
        } catch {
          // 忽略
        }
      }, 10);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 策略 3: 全局与局部穿透式 Drag & Drop 状态机仿真
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
        bubbles: true,
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

      setTimeout(() => {
        try {
          dataTransfer.items.clear();
        } catch {
          // 忽略
        }
      }, 50);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 互斥式文件挂载入口：提供 1500ms 指纹时间锁与精确熔断机制
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

    // 针对豆包等富文本聊天平台，优先使用精准定向且防冒泡的 Paste 策略
    if (currentHost.includes("doubao.com")) {
      if (this.tryPasteEvent(activeEl, dataTransfer)) {
        return true;
      }
    }

    // 优先策略 1: 扫描并触发 input[type="file"]（内置自动解绑与 Unmount 机制）
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
