export class UniversalEditor {
  /**
   * 校验 file input 是否接受指定文件类型（兼容处理仅写了 .txt 而未声明 .md 的 AI 平台）
   */
  private static isValidFileInput(
    input: HTMLInputElement,
    file: File,
  ): boolean {
    if (input.disabled) return false;
    const accept = input.accept?.trim();
    if (!accept) return true;

    const acceptPatterns = accept
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (acceptPatterns.length === 0) return true;

    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();

    return acceptPatterns.some((pattern) => {
      if (pattern === "*/*" || pattern === "*") return true;
      // 允许 .md 挂载至接受纯文本/文档的控件
      if (pattern === ".txt" || pattern === "text/plain") return true;
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
   * 策略 1: 扫描并触发原生 input[type="file"] 挂载
   */
  private static tryUploadViaFileInput(
    file: File,
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    // 优先从就近容器、通用表单容器寻找
    const searchScopes = [
      activeEl?.closest("form"),
      activeEl?.closest('[class*="chat"]'),
      activeEl?.closest('[class*="input"]'),
      activeEl?.closest('[role="presentation"]'),
      activeEl?.parentElement?.parentElement,
      document.querySelector('[role="main"]'),
      document.querySelector("main"),
      document.body, // 全局兜底以应对 Tailwind 混淆类名
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

          // 核心修复：仅触发 change 事件，严禁触发 input 事件以防止部分平台触发两次上传
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
   * 策略 2: 模拟粘贴 ClipboardEvent('paste')
   */
  private static tryPasteEvent(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    if (!activeEl) return false;

    const pasteTargets = [
      activeEl,
      activeEl.isContentEditable
        ? activeEl
        : (activeEl.closest("[contenteditable='true']") as HTMLElement | null),
      activeEl.closest("textarea"),
    ].filter((el): el is HTMLElement => Boolean(el));

    for (const target of pasteTargets) {
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer,
      });

      const dispatched = target.dispatchEvent(pasteEvent);
      // 若网站显式取消了事件，说明已被处理
      if (!dispatched || pasteEvent.defaultPrevented) return true;
    }

    return false;
  }

  /**
   * 策略 3: 完整的 Drag & Drop 状态机多靶心仿真
   */
  private static tryDragAndDrop(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    const eventInit: DragEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer,
    };

    const dropTargets: EventTarget[] = [
      ...(activeEl ? [activeEl] : []),
      ...(activeEl?.closest("form") ? [activeEl.closest("form")!] : []),
      ...Array.from(
        document.querySelectorAll(
          '[data-dropzone="true"], [class*="dropzone"], [class*="drop-target"]',
        ),
      ),
      document.body,
    ];

    const uniqueDropTargets = Array.from(new Set(dropTargets));

    let recognizedDropzone: EventTarget | null = null;
    for (const target of uniqueDropTargets) {
      const enterEvt = new DragEvent("dragenter", eventInit);
      target.dispatchEvent(enterEvt);

      const overEvt = new DragEvent("dragover", eventInit);
      const overPrevented = !target.dispatchEvent(overEvt);

      if (overPrevented && !recognizedDropzone) {
        recognizedDropzone = target;
      }
    }

    const prioritizedTargets = recognizedDropzone
      ? [recognizedDropzone]
      : uniqueDropTargets;

    for (const target of prioritizedTargets) {
      const dropEvt = new DragEvent("drop", eventInit);
      const dropPrevented = !target.dispatchEvent(dropEvt);

      if (dropPrevented || dropEvt.defaultPrevented) {
        return true;
      }
    }

    return Boolean(recognizedDropzone);
  }

  /**
   * 互斥式挂载：按优先级依次尝试，一旦前驱成功，立刻熔断返回，绝不继续执行后续策略
   */
  public static attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): boolean {
    const activeEl = (
      targetElement instanceof HTMLElement
        ? targetElement
        : document.activeElement
    ) as HTMLElement | null;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // 1. 尝试就近查找并驱动原生文件输入框
    if (this.tryUploadViaFileInput(file, activeEl, dataTransfer)) {
      return true;
    }

    // 2. 尝试标准 Clipboard 粘贴事件
    if (this.tryPasteEvent(activeEl, dataTransfer)) {
      return true;
    }

    // 3. 尝试拖拽 (Drag & Drop) 仿真
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
