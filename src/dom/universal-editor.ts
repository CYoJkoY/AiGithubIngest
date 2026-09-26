export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = "";
  private static isUploading = false;

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

    // 跨作用域去重收集候选控件，杜绝多重 scope 命中同一个 DOM 节点时重复派发
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

    // 优先级排序：专属于 Markdown/文本的控件 > 临近当前输入区的控件 > 当前处于可见状态的控件
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

    // 严格限制为单一靶向操作：仅选定全局最优的一个控件，禁止循环向多个控件赋值
    const fileInput = candidateInputs[0];

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

      if (isDoubao) {
        // 豆包平台派发非冒泡 change 事件，防止 #root 委托层与原生监听器各执行一次导致双重上传
        const changeEvent = new Event("change", {
          bubbles: false,
          cancelable: true,
          composed: false,
        });
        fileInput.dispatchEvent(changeEvent);
      } else {
        fileInput.dispatchEvent(
          new Event("change", { bubbles: true, composed: true }),
        );
      }

      return true;
    } catch {
      // 一旦已触及原型链 Setter 赋值，说明该控件已接收到文件数据，阻断继续降级导致双重挂载
      return isDoubao ? true : false;
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

    try {
      target.focus();
      // 针对豆包等具备全局与局部双重 paste 监听器的平台，派发非冒泡 paste 事件，阻断向上冒泡至 window
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: !isDoubao,
        cancelable: true,
        composed: !isDoubao,
        clipboardData: dataTransfer,
      });

      target.dispatchEvent(pasteEvent);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 策略 3: 精准单靶心 Drag & Drop 状态机仿真
   */
  private static tryDragAndDrop(
    activeEl: HTMLElement | null,
    dataTransfer: DataTransfer,
  ): boolean {
    const currentHost = window.location.hostname.toLowerCase();
    const isDoubao = currentHost.includes("doubao.com");

    const candidateTargets = [
      document.querySelector('[data-dropzone="true"]'),
      document.querySelector('[class*="dropzone"]'),
      document.querySelector('[class*="drop-target"]'),
      activeEl?.closest('[class*="editor"]'),
      activeEl?.closest('[class*="input"]'),
      activeEl?.closest('[class*="chat"]'),
      activeEl,
      document.querySelector('[role="main"]'),
      document.querySelector("main"),
      document.body,
    ].filter((el): el is HTMLElement => Boolean(el));

    if (candidateTargets.length === 0) return false;

    // 仅选取最接近输入意图的单个目标，禁止向整条祖先链所有节点重复派发事件
    const bestTarget = candidateTargets[0];

    try {
      const eventInit: DragEventInit = {
        bubbles: !isDoubao,
        cancelable: true,
        composed: !isDoubao,
        dataTransfer,
      };

      const dragEnter = new DragEvent("dragenter", eventInit);
      const dragOver = new DragEvent("dragover", eventInit);
      const drop = new DragEvent("drop", eventInit);

      bestTarget.dispatchEvent(dragEnter);
      bestTarget.dispatchEvent(dragOver);
      bestTarget.dispatchEvent(drop);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 互斥式文件挂载入口：增加并发锁、1500ms 任务指纹时间锁与精准熔断机制
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

      // 优先策略 1: 扫描并触发 input[type="file"]
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
    } finally {
      setTimeout(() => {
        this.isUploading = false;
      }, 500);
    }
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
