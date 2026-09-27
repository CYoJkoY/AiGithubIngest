const QWEN_DEBUG = true;

export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = "";

  private static log(...args: unknown[]): void {
    if (QWEN_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[AiGithubIngest/Qwen]", ...args);
    }
  }

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

  private static mountFileToInput(
    input: HTMLInputElement,
    dataTransfer: DataTransfer,
  ): void {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "files",
      );

      if (descriptor?.set) {
        descriptor.set.call(input, dataTransfer.files);
      } else {
        input.files = dataTransfer.files;
      }

      const tracker = (
        input as unknown as {
          _valueTracker?: { setValue: (val: string) => void };
        }
      )._valueTracker;
      if (tracker) {
        tracker.setValue("");
      }

      input.dispatchEvent(
        new Event("input", { bubbles: true, composed: true }),
      );
      input.dispatchEvent(
        new Event("change", { bubbles: true, composed: true }),
      );

      // Qwen 的上传管线可能需要更多时间读取文件；延长到 4 秒后再清理
      setTimeout(() => {
        UniversalEditor.cleanUpFileInput(input);
      }, 4000);
    } catch {
      // 容错处理
    }
  }

  /**
   * 派发完整的指针 + 鼠标事件序列
   *
   * 用于需要 pointerdown 才能触发下拉展开的组件（Ant Design Dropdown）
   */
  private static dispatchFullClickSequence(el: HTMLElement): void {
    let rect: DOMRect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      rect = new DOMRect(0, 0, 0, 0);
    }

    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    const baseInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons: 1,
    };

    const pointerInit: PointerEventInit = {
      ...baseInit,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };

    try {
      el.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
    } catch {
      // PointerEvent 可能不可用
    }
    try {
      el.dispatchEvent(new MouseEvent("mousedown", baseInit));
    } catch {
      // 忽略
    }
    try {
      el.dispatchEvent(
        new PointerEvent("pointerup", { ...pointerInit, buttons: 0 }),
      );
    } catch {
      // 忽略
    }
    try {
      el.dispatchEvent(new MouseEvent("mouseup", { ...baseInit, buttons: 0 }));
    } catch {
      // 忽略
    }
    try {
      el.dispatchEvent(new MouseEvent("click", { ...baseInit, buttons: 0 }));
    } catch {
      // 忽略
    }
  }

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
        this.mountFileToInput(fileInput, dataTransfer);
        return true;
      }
    }

    return false;
  }

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

  private static tryDoubaoUpload(
    file: File,
    dataTransfer: DataTransfer,
  ): boolean {
    const directInput = document.querySelector<HTMLInputElement>(
      'input[data-testid="upload-file-input"], input[type="file"]',
    );

    if (directInput && this.isValidFileInput(directInput, file)) {
      this.mountFileToInput(directInput, dataTransfer);
      return true;
    }

    const attachBtn = document.querySelector<HTMLElement>(
      'button[data-testid="upload_file_button"]',
    );

    if (!attachBtn) {
      return false;
    }

    const clickBlocker = (e: Event): void => {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === "file") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener("click", clickBlocker, true);

    const originalShowPicker = (
      HTMLInputElement.prototype as unknown as {
        showPicker?: () => void;
      }
    ).showPicker;
    let showPickerPatched = false;

    if (typeof originalShowPicker === "function") {
      try {
        (
          HTMLInputElement.prototype as unknown as {
            showPicker: () => void;
          }
        ).showPicker = function (this: HTMLInputElement): void {
          if (this.type === "file") return;
          return originalShowPicker.call(this);
        };
        showPickerPatched = true;
      } catch {
        // 容错处理
      }
    }

    try {
      attachBtn.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    } catch {
      // 容错处理
    }

    setTimeout(() => {
      const newInput = document.querySelector<HTMLInputElement>(
        'input[data-testid="upload-file-input"], input[type="file"]',
      );

      if (newInput && this.isValidFileInput(newInput, file)) {
        this.mountFileToInput(newInput, dataTransfer);
      }
    }, 200);

    setTimeout(() => {
      try {
        document.removeEventListener("click", clickBlocker, true);
        if (showPickerPatched) {
          (
            HTMLInputElement.prototype as unknown as {
              showPicker?: () => void;
            }
          ).showPicker = originalShowPicker;
        }
      } catch {
        // 容错处理
      }
    }, 1000);

    return true;
  }

  /**
   * 定位 Qwen "+" 模式选择按钮
   */
  private static findQwenModeButton(): HTMLElement | null {
    const byClass = document.querySelector<HTMLElement>(".mode-select-open");
    if (byClass && !byClass.hasAttribute("disabled")) {
      return byClass;
    }

    const ariaCandidates = ["选择模式", "Select mode", "选择"];
    for (const label of ariaCandidates) {
      const btn = document.querySelector<HTMLElement>(
        `[role="button"][aria-label="${label}"]`,
      );
      if (btn && !btn.hasAttribute("disabled")) {
        return btn;
      }
    }

    const allUses = Array.from(document.querySelectorAll("use"));
    for (const use of allUses) {
      const href =
        use.getAttribute("href") ||
        use.getAttribute("xlink:href") ||
        use.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (href === "#qwpcicon-addBold") {
        const btn = use.closest<HTMLElement>('[role="button"]');
        if (btn && !btn.hasAttribute("disabled")) {
          return btn;
        }
      }
    }

    return null;
  }

  /**
   * 定位 "上传附件" 菜单项
   */
  private static findQwenUploadMenuItem(): HTMLElement | null {
    const menuItems = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    if (menuItems.length === 0) return null;

    for (const item of menuItems) {
      const uses = Array.from(item.querySelectorAll("use"));
      const hit = uses.some((use) => {
        const href =
          use.getAttribute("href") ||
          use.getAttribute("xlink:href") ||
          use.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        return href === "#qwpcicon-upload";
      });
      if (hit) return item;
    }

    const uploadTexts = [
      "上传附件",
      "上传文件",
      "Upload attachment",
      "Upload file",
    ];
    for (const item of menuItems) {
      const nameEl = item.querySelector(".mode-select-dropdown-item-name");
      const text = (nameEl?.textContent || item.textContent || "").trim();
      if (uploadTexts.some((kw) => text.includes(kw))) {
        return item;
      }
    }

    for (const item of menuItems) {
      if (
        item.querySelector(".mode-select-dropdown-item") &&
        /upload|附件/i.test(item.textContent || "")
      ) {
        return item;
      }
    }

    return null;
  }

  /**
   * Qwen 专用文件挂载（异步版本，精确等待真实挂载结果）
   *
   * 与旧版关键差异：
   *   - 使用 Promise 异步等待，不再乐观返回 true
   *   - 检测菜单是否已展开，避免重复点 "+" 反而关闭菜单
   *   - 菜单项只用朴素 click（与 probe 一致），不用完整事件序列
   */
  private static tryQwenUploadAsync(
    file: File,
    dataTransfer: DataTransfer,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // 1. 快路径：input 已存在
      const directInput =
        document.querySelector<HTMLInputElement>('input[type="file"]');
      if (directInput && this.isValidFileInput(directInput, file)) {
        this.log("fast path: direct input found, mounting");
        this.mountFileToInput(directInput, dataTransfer);
        resolve(true);
        return;
      }

      // 2. 安装拦截器（早装早保护）
      const clickBlocker = (e: Event): void => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.type === "file") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      };
      document.addEventListener("click", clickBlocker, true);

      const originalShowPicker = (
        HTMLInputElement.prototype as unknown as {
          showPicker?: () => void;
        }
      ).showPicker;
      let showPickerPatched = false;
      if (typeof originalShowPicker === "function") {
        try {
          (
            HTMLInputElement.prototype as unknown as {
              showPicker: () => void;
            }
          ).showPicker = function (this: HTMLInputElement): void {
            if (this.type === "file") return;
            return originalShowPicker.call(this);
          };
          showPickerPatched = true;
        } catch {
          // 容错
        }
      }

      const preExistingInputs = new Set<HTMLInputElement>(
        Array.from(
          document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
        ),
      );

      const timers: Array<ReturnType<typeof setTimeout>> = [];
      let menuItemClicked = false;
      let mounted = false;
      let resolved = false;

      const cleanup = (): void => {
        try {
          document.removeEventListener("click", clickBlocker, true);
          if (showPickerPatched) {
            (
              HTMLInputElement.prototype as unknown as {
                showPicker?: () => void;
              }
            ).showPicker = originalShowPicker;
          }
        } catch {
          // 容错
        }
        for (const t of timers) clearTimeout(t);
      };

      const finish = (success: boolean): void => {
        if (resolved) return;
        resolved = true;
        this.log("finish:", success);
        cleanup();
        resolve(success);
      };

      const tryMount = (): void => {
        if (mounted || resolved) return;
        const all = Array.from(
          document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
        );
        const newOnes = all.filter((i) => !preExistingInputs.has(i));
        const oldOnes = all.filter((i) => preExistingInputs.has(i));
        const ordered = [...newOnes, ...oldOnes];

        for (const inp of ordered) {
          if (this.isValidFileInput(inp, file)) {
            this.log(
              "mounting into input:",
              inp.id || inp.outerHTML.slice(0, 80),
            );
            this.mountFileToInput(inp, dataTransfer);
            mounted = true;
            finish(true);
            return;
          }
        }
      };

      const clickMenuItem = (): void => {
        if (menuItemClicked || resolved) return;
        const item = this.findQwenUploadMenuItem();
        if (!item) {
          this.log("clickMenuItem: menu item not found yet");
          return;
        }
        menuItemClicked = true;
        this.log("clicking menu item:", item.textContent?.slice(0, 40));
        // 关键：只用朴素 click，与 probe 完全一致
        try {
          item.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
        } catch {
          // 容错
        }
      };

      // 3. 判断菜单是否已经展开
      const existingItem = this.findQwenUploadMenuItem();
      if (existingItem) {
        this.log("menu already open, clicking menu item directly");
        menuItemClicked = true;
        try {
          existingItem.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
        } catch {
          // 容错
        }
      } else {
        // 4. 需要先展开菜单
        const modeBtn = this.findQwenModeButton();
        if (!modeBtn) {
          this.log("mode button not found");
          finish(false);
          return;
        }
        this.log("mode button found:", modeBtn.className, "dispatching click");
        this.dispatchFullClickSequence(modeBtn);

        // 与 probe 一致的时序：500ms 后点菜单项
        timers.push(setTimeout(clickMenuItem, 500));
        timers.push(setTimeout(clickMenuItem, 800));
        timers.push(setTimeout(clickMenuItem, 1200));
      }

      // 5. 轮询挂载（涵盖菜单刚打开时的 700ms 扫描点）
      timers.push(setTimeout(tryMount, 300));
      timers.push(setTimeout(tryMount, 600));
      timers.push(setTimeout(tryMount, 900));
      timers.push(setTimeout(tryMount, 1300));
      timers.push(setTimeout(tryMount, 1800));
      timers.push(setTimeout(tryMount, 2400));
      timers.push(setTimeout(tryMount, 3000));

      // 6. 超时兜底
      timers.push(
        setTimeout(() => {
          if (!mounted) {
            this.log("timeout: never mounted");
            finish(false);
          }
        }, 3600),
      );
    });
  }

  /**
   * 互斥式文件挂载入口（异步）
   */
  public static async attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): Promise<boolean> {
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

    if (currentHost.includes("doubao.com")) {
      return this.tryDoubaoUpload(file, dataTransfer);
    }

    if (
      currentHost.includes("qwen.ai") ||
      currentHost.includes("qwen.com") ||
      currentHost.includes("tongyi.aliyun.com")
    ) {
      return this.tryQwenUploadAsync(file, dataTransfer);
    }

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
