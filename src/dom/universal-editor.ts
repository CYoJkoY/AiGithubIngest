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
   * 查找页面中可能存在的附件上传按钮（仅 mouseenter 唤起）
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
   * 豆包专用：合成点击附件按钮 → 等 input 出现 → 挂载文件
   *
   * 背景与实测（见 DevTools Console 日志）：
   *   1. 豆包输入框是 tiptap / ProseMirror contenteditable，页面初始状态
   *      没有任何 input[type="file"]。
   *   2. paste 事件在豆包上完全无效：豆包内部的 sync-input-engine 会把
   *      ClipboardEvent 剥离掉 clipboardData，导致 e.clipboardData 恒为
   *      null，最终 0 上传。
   *   3. drop 事件在豆包上也被静默忽略：tiptap 的 handleDrop 只处理图片，
   *      Markdown 文件被丢弃。
   *   4. 唯一可行路径：走豆包官方的附件按钮 → 让框架动态创建 input
   *      [type="file"] → 挂载文件。
   *
   * 实现：
   *   - 使用 dispatchEvent(new MouseEvent('click', ...)) 而不是 .click()，
   *     因为合成 click 不满足 transient activation，不会弹出系统文件选择
   *     对话框，但仍会触发 React 的 onClick 处理器让框架准备好 input。
   *   - 记录点击前已存在的 input 集合，点击后延迟扫描新增的 input。
   *   - 找到合适 input 后设置 files 并触发 input / change。
   */
  private static tryDoubaoAttachmentFlow(
    file: File,
    dataTransfer: DataTransfer,
  ): boolean {
    console.log("[AiIngest] doubao attachment flow start");

    // 1. 定位附件按钮
    const attachBtnSelectors = [
      'button[aria-label*="上传"]',
      'button[aria-label*="附件"]',
      'button[aria-label*="文件"]',
      'button[title*="上传"]',
      'button[title*="附件"]',
      'button[title*="文件"]',
      'button[aria-label*="upload" i]',
      'button[aria-label*="attach" i]',
      'button[aria-label*="file" i]',
      'button[title*="upload" i]',
      'button[title*="attach" i]',
      'button[title*="file" i]',
      '[role="button"][aria-label*="上传"]',
      '[role="button"][aria-label*="附件"]',
      '[role="button"][aria-label*="upload" i]',
      '[role="button"][aria-label*="attach" i]',
    ];

    let attachBtn: HTMLElement | null = null;
    let matchedSelector = "";
    for (const sel of attachBtnSelectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        attachBtn = el;
        matchedSelector = sel;
        break;
      }
    }

    if (!attachBtn) {
      console.log("[AiIngest] doubao: no attachment button matched");
      return false;
    }

    console.log(
      "[AiIngest] doubao: matched attachment button",
      matchedSelector,
    );

    // 2. 记录点击前已有的 file input
    const beforeInputs = new Set<HTMLInputElement>(
      Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
      ),
    );

    // 3. 合成 click（不会弹出系统文件选择器）
    try {
      attachBtn.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      console.log("[AiIngest] doubao: dispatched synthetic click");
    } catch (e) {
      console.log("[AiIngest] doubao: dispatch click failed", e);
      return false;
    }

    // 4. 延迟扫描新出现的 input 并挂载文件
    setTimeout(() => {
      const allInputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
      );
      const newInputs = allInputs.filter((el) => !beforeInputs.has(el));
      const candidates = newInputs.length > 0 ? newInputs : allInputs;

      console.log("[AiIngest] doubao: scanned inputs after click", {
        total: allInputs.length,
        newCount: newInputs.length,
      });

      for (const fileInput of candidates) {
        if (!this.isValidFileInput(fileInput, file)) {
          console.log("[AiIngest] doubao: input not valid, skip", {
            accept: fileInput.accept,
          });
          continue;
        }

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
            new Event("input", { bubbles: true, composed: true }),
          );
          fileInput.dispatchEvent(
            new Event("change", { bubbles: true, composed: true }),
          );

          console.log(
            "[AiIngest] doubao: dispatched input/change on file input",
          );

          // 800ms 后清空物理 input，避免文件常驻
          setTimeout(() => {
            UniversalEditor.cleanUpFileInput(fileInput);
          }, 800);

          return;
        } catch (e) {
          console.log("[AiIngest] doubao: input dispatch failed", e);
        }
      }

      console.log(
        "[AiIngest] doubao: attachment flow finished, no suitable input",
      );
    }, 250);

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

    // 豆包：paste 和 drop 都已被实测证明不可行，改走"合成点击附件按钮"
    if (currentHost.includes("doubao.com")) {
      console.log("[AiIngest] doubao branch: tryDoubaoAttachmentFlow");
      if (this.tryDoubaoAttachmentFlow(file, dataTransfer)) {
        return true;
      }
      // 没有任何附件按钮 → 返回 false 让上游走文本 fallback
      console.log(
        "[AiIngest] doubao: attachment flow failed, return false for fallback",
      );
      return false;
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
