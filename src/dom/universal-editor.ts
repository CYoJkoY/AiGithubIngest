export class UniversalEditor {
  /**
   * 校验 file input 是否接受指定文件类型（避免误击头像或非文本上传控件）
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
      if (pattern.startsWith(".")) {
        return fileName.endsWith(pattern);
      }
      if (pattern.endsWith("/*")) {
        const mimeCategory = pattern.slice(0, pattern.indexOf("/"));
        return fileType.startsWith(`${mimeCategory}/`);
      }
      return fileType === pattern;
    });
  }

  /**
   * 策略 1: 扫描并触发就近的 input[type="file"] 原生挂载
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
      activeEl?.closest('[role="presentation"]'),
      activeEl?.parentElement?.parentElement,
      document.querySelector('[role="main"]'),
      document.querySelector("main"),
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

          fileInput.dispatchEvent(
            new Event("input", { bubbles: true, composed: true }),
          );
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

      const handled = !target.dispatchEvent(pasteEvent);
      if (handled) return true;
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

    // 收集潜在的 Drop 目标容器（由内向外、包含特征 Dropzone）
    const dropTargets: EventTarget[] = [
      ...(activeEl ? [activeEl] : []),
      ...(activeEl?.closest("form") ? [activeEl.closest("form")!] : []),
      ...(activeEl?.closest('[class*="input"]')
        ? [activeEl.closest('[class*="input"]')!]
        : []),
      ...(activeEl?.closest('[class*="chat"]')
        ? [activeEl.closest('[class*="chat"]')!]
        : []),
      ...(activeEl?.closest('[role="presentation"]')
        ? [activeEl.closest('[role="presentation"]')!]
        : []),
      ...Array.from(
        document.querySelectorAll(
          '[data-dropzone="true"], [class*="dropzone"], [class*="drop-target"]',
        ),
      ),
      document.body,
      window,
    ];

    const uniqueDropTargets = Array.from(new Set(dropTargets));

    // 步骤 3.1: 完整派发 dragenter 与 dragover 序列以激活各站点的 isDragActive 状态机
    let recognizedDropzone: EventTarget | null = null;

    for (const target of uniqueDropTargets) {
      const enterEvt = new DragEvent("dragenter", eventInit);
      target.dispatchEvent(enterEvt);

      const overEvt = new DragEvent("dragover", eventInit);
      const overPrevented = !target.dispatchEvent(overEvt);

      // 若节点在 dragover 阶段调用了 preventDefault，代表其符合 W3C 标准被标记为接收端
      if (overPrevented && !recognizedDropzone) {
        recognizedDropzone = target;
      }
    }

    // 步骤 3.2: 派发 drop 事件（优先命中声明接受 drop 的节点）
    const prioritizedTargets = recognizedDropzone
      ? [
          recognizedDropzone,
          ...uniqueDropTargets.filter((t) => t !== recognizedDropzone),
        ]
      : uniqueDropTargets;

    for (const target of prioritizedTargets) {
      const dropEvt = new DragEvent("drop", eventInit);
      const dropPrevented = !target.dispatchEvent(dropEvt);

      if (dropPrevented || dropEvt.defaultPrevented) {
        return true;
      }
    }

    // 若有 dropzone 明确阻断了 dragover，说明已进入该容器的处理链路
    return Boolean(recognizedDropzone);
  }

  /**
   * 将生成的代码摘要打包为虚拟 File 对象，优先以“附件”形式挂载至宿主网页。
   * 依次尝试：就近 FileInput -> 模拟 Paste -> 完整 DND 仿真。
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

    // 3. 尝试多层级级联拖拽 (Drag & Drop) 仿真
    if (this.tryDragAndDrop(activeEl, dataTransfer)) {
      return true;
    }

    return false;
  }

  /**
   * 轻量化文本注入：仅用于错误回退或简短元数据插入，绝不塞入全量大文本
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
        // 静默捕获非文本输入框异常
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
