export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = "";

  /**
   * 校验 file input 是否接受指定文件类型（兼容处理仅写了 .txt/.doc/.pdf 等通用文档而未显式声明 .md 的 AI 平台）
   */
  private static isValidFileInput(
    input: HTMLInputElement,
    file: File,
  ): boolean {
    if (input.disabled) return false;
    const accept = input.accept?.trim();
    if (!accept) return true;

    const acceptPatterns = accept
      .toLowerCase()
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (acceptPatterns.length === 0) return true;

    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();

    // 针对 AI 聊天平台的附件上传入口（接受文档/通用文本）进行智能放行
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
        pattern === ".pdf"
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
   * 策略 1: 扫描并触发原生 input[type="file"] 挂载（兼容 React 16/17/18 内部状态追踪）
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

        try {
          // 通过原型链 Setter 绕过 React 16+ 受控组件属性劫持
          const descriptor = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "files",
          );

          if (descriptor?.set) {
            descriptor.set.call(fileInput, dataTransfer.files);
          } else {
            fileInput.files = dataTransfer.files;
          }

          // 核心兼容：通知 React 内部 valueTracker，使 React 合成 onChange 正常响应
          const tracker = (
            fileInput as unknown as {
              _valueTracker?: { setValue: (val: string) => void };
            }
          )._valueTracker;
          if (tracker) {
            tracker.setValue("");
          }

          // 触发单个标准的 change 冒泡事件，绝不触发额外的 input 事件以防二次上传
          fileInput.dispatchEvent(
            new Event("change", { bubbles: true, composed: true }),
          );
          return true;
        } catch {
          // 遇到受限 DOM 继续尝试后续候选
        }
      }
    }

    return false;
  }

  /**
   * 策略 2: 单靶向精准模拟粘贴 ClipboardEvent('paste')
   */
  private static tryPasteEvent(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    // 选定唯一最精准的目标元素，避免向多层祖先重复派发
    const target =
      activeEl ||
      (document.querySelector(
        'textarea, [contenteditable="true"], [role="textbox"]',
      ) as HTMLElement | null);

    if (!target) return false;

    try {
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
    }
  }

  /**
   * 策略 3: 单靶向 Drag & Drop 状态机仿真
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

    const target = candidateTargets[0] || document.body;

    try {
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
    }
  }

  /**
   * 互斥式挂载：增加时间锁与唯一靶向，一旦成功立刻熔断返回，绝不重复上传
   */
  public static attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): boolean {
    // 1. 防重保护锁：1500ms 内对同一文件名的请求直接视为已挂载，彻底杜绝多次上传
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

    // 优先策略 1: 扫描并触发原生 input[type="file"]
    if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
      return true;
    }

    // 优先策略 2: 单靶向精准 Clipboard 粘贴事件
    if (this.tryPasteEvent(activeEl, dataTransfer)) {
      return true;
    }

    // 优先策略 3: 单靶向 Drag & Drop 仿真
    if (this.tryDragAndDrop(activeEl, dataTransfer)) {
      return true;
    }

    return false;
  }

  /**
   * 轻量化文本注入：仅用于错误回退或简短元数据插入
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

    // 2. contenteditable 容器
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
