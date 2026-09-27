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
   * 清理并解绑物理 input 节点上的文件常驻状态，
   * 防止文件持续悬挂导致后续操作重复提交
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
   * 将文件挂载到指定 input，并派发 input / change 事件通知宿主框架
   */
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

      // 留出异步读取窗口后清空物理 DOM 节点，防止文件常驻挂载
      setTimeout(() => {
        UniversalEditor.cleanUpFileInput(input);
      }, 1000);
    } catch {
      // 容错处理
    }
  }

  /**
   * 派发完整的鼠标/指针事件序列
   *
   * Ant Design 的 Dropdown / Menu 组件监听的是 pointerdown + click 组合，
   * 单独派发 click 事件在部分版本上无法触发下拉展开或菜单项点击。
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

    // 依次派发完整事件序列，每一步独立 try 避免 PointerEvent 缺失导致全断
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
    } catch {
      // 某些环境可能不支持 PointerEvent
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

  /**
   * 策略 1: 扫描并触发原生 input[type="file"] 挂载
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
        this.mountFileToInput(fileInput, dataTransfer);
        return true;
      }
    }

    return false;
  }

  /**
   * 策略 2: 剪贴板事件仿真
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
   * 豆包专用文件挂载流程
   *
   * 豆包输入框是 tiptap / ProseMirror contenteditable，页面初始没有任何
   * input[type="file"]，只有在点击附件按钮后才动态创建隐藏 input。
   *
   * paste / drop 路径在豆包上均被实测证明不可行（sync-input-engine 会剥离
   * clipboardData，tiptap handleDrop 只处理图片），唯一可行路径是：
   *
   *   1. 精确定位附件按钮 button[data-testid="upload_file_button"]
   *   2. 在 document 上安装捕获阶段的 click 拦截器，阻止浏览器弹出系统文件
   *      选择器（豆包内部通过向 input 元素派发 click 事件触发，绕过
   *      HTMLInputElement.prototype.click / showPicker）
   *   3. 派发合成 click 触发 React onClick，让豆包渲染出隐藏 input
   *   4. 挂载文件到 input 并派发 input / change 事件
   *   5. 1 秒后移除拦截器，恢复用户后续正常操作
   */
  private static tryDoubaoUpload(
    file: File,
    dataTransfer: DataTransfer,
  ): boolean {
    // 1. 快路径：input 可能已经在 DOM 中
    const directInput = document.querySelector<HTMLInputElement>(
      'input[data-testid="upload-file-input"], input[type="file"]',
    );

    if (directInput && this.isValidFileInput(directInput, file)) {
      this.mountFileToInput(directInput, dataTransfer);
      return true;
    }

    // 2. 慢路径：点击附件按钮触发 input 渲染
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
   * 定位 Qwen 输入框左下角的 "+" 模式选择按钮
   *
   * 真实 DOM（chat.qwen.ai，2026-09 采样）：
   *   <div class="qwen-chat-v2-dropdown-menu-trigger">
   *     <div class="mode-select-open" role="button" aria-label="选择模式">
   *       <span class="anticon mode-select-open-icon">
   *         <svg><use xlink:href="#qwpcicon-addBold"></use></svg>
   *       </span>
   *     </div>
   *   </div>
   */
  private static findQwenModeButton(): HTMLElement | null {
    // 优先级 1：类名（跨语言稳定）
    const byClass = document.querySelector<HTMLElement>(".mode-select-open");
    if (byClass && !byClass.hasAttribute("disabled")) {
      return byClass;
    }

    // 优先级 2：aria-label（中英文兼容）
    const ariaCandidates = ["选择模式", "Select mode", "选择"];
    for (const label of ariaCandidates) {
      const btn = document.querySelector<HTMLElement>(
        `[role="button"][aria-label="${label}"]`,
      );
      if (btn && !btn.hasAttribute("disabled")) {
        return btn;
      }
    }

    // 优先级 3：通过 icon use href 回溯（跨语言最稳）
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
   * 定位展开后下拉菜单中的 "上传附件" 菜单项
   *
   * 真实 DOM：
   *   <div role="menuitem" class="qwen-chat-v2-dropdown-menu-item ...">
   *     ...
   *     <svg><use xlink:href="#qwpcicon-upload"></use></svg>
   *     ...
   *     <span class="mode-select-dropdown-item-name">上传附件</span>
   *   </div>
   */
  private static findQwenUploadMenuItem(): HTMLElement | null {
    const menuItems = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    if (menuItems.length === 0) return null;

    // 优先级 1：内含 #qwpcicon-upload 图标（跨语言最稳）
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

    // 优先级 2：通过 .mode-select-dropdown-item-name 文本匹配
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

    // 优先级 3：包含 .mode-select-dropdown-item 且带 upload/附件 关键字
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
   * Qwen (chat.qwen.ai / qwen.ai / tongyi.aliyun.com) 专用文件挂载流程
   *
   * Qwen 的附件上传是"两步下拉菜单"交互，与豆包单步按钮截然不同：
   *
   *   1. 点击输入框左下角 "+" 按钮 (aria-label="选择模式") → 展开 dropdown
   *   2. 点击菜单项 "上传附件" (role="menuitem") → 宿主创建 input[type="file"]
   *      并立即调用 .click() 弹系统文件选择器
   *
   * 关键改进（相比硬编码延迟版本）：
   *   - 使用 dispatchFullClickSequence 派发完整 pointer + mouse 事件序列，
   *     确保 Ant Design 的 onPointerDown / onClick 处理器被触发
   *   - 用 MutationObserver 精准等待菜单项、file input 出现，而非猜测时间
   *   - 保留多段定时兜底扫描，防止 Observer 漏掉某些异步渲染
   *   - 5 秒后无论成败强制清理拦截器与 patch
   */
  private static tryQwenUpload(
    file: File,
    dataTransfer: DataTransfer,
  ): boolean {
    // 1. 快路径：input 已存在（用户此前已用过上传功能）
    const directInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (directInput && this.isValidFileInput(directInput, file)) {
      this.mountFileToInput(directInput, dataTransfer);
      return true;
    }

    // 2. 定位 "+" 按钮
    const modeBtn = this.findQwenModeButton();
    if (!modeBtn) {
      return false;
    }

    // 3. 捕获阶段拦截系统文件选择器弹出（仅针对 file input）
    const clickBlocker = (e: Event): void => {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === "file") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", clickBlocker, true);

    // 4. patch showPicker 兼容部分 Chromium 变体
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

    // 记录点击前已存在的 file input
    const preExistingInputs = new Set<HTMLInputElement>(
      Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
      ),
    );

    // 状态标记
    let menuItemClicked = false;
    let mounted = false;

    // 尝试挂载的函数（供 Observer 与定时器复用）
    const tryMount = (): boolean => {
      if (mounted) return true;
      const allInputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
      );
      const ordered = [
        ...allInputs.filter((i) => !preExistingInputs.has(i)),
        ...allInputs,
      ];
      for (const input of ordered) {
        if (this.isValidFileInput(input, file)) {
          this.mountFileToInput(input, dataTransfer);
          mounted = true;
          return true;
        }
      }
      return false;
    };

    // 尝试点击"上传附件"菜单项
    const clickMenuItem = (): boolean => {
      if (menuItemClicked) return true;
      const menuItem = this.findQwenUploadMenuItem();
      if (!menuItem) return false;
      menuItemClicked = true;
      this.dispatchFullClickSequence(menuItem);
      return true;
    };

    // 5. 使用 MutationObserver 精确等待菜单项与 file input 出现
    const observer = new MutationObserver(() => {
      if (!menuItemClicked) {
        clickMenuItem();
      }
      if (menuItemClicked && !mounted) {
        tryMount();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // 6. 派发完整鼠标事件序列到 "+" 按钮 → 触发展开下拉菜单
    this.dispatchFullClickSequence(modeBtn);

    // 7. 时间点兜底（防止某些异步渲染没触发 observer 或 observer 被过早阻塞）
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    // 菜单项点击兜底
    timers.push(setTimeout(clickMenuItem, 150));
    timers.push(setTimeout(clickMenuItem, 400));
    timers.push(setTimeout(clickMenuItem, 800));
    timers.push(setTimeout(clickMenuItem, 1500));

    // input 挂载兜底
    timers.push(setTimeout(tryMount, 300));
    timers.push(setTimeout(tryMount, 600));
    timers.push(setTimeout(tryMount, 1000));
    timers.push(setTimeout(tryMount, 1600));
    timers.push(setTimeout(tryMount, 2400));
    timers.push(setTimeout(tryMount, 3200));

    // 8. 5 秒后统一清理
    timers.push(
      setTimeout(() => {
        try {
          observer.disconnect();
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
      }, 5000),
    );

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

    // 豆包专用分支（单步按钮交互）
    if (currentHost.includes("doubao.com")) {
      return this.tryDoubaoUpload(file, dataTransfer);
    }

    // Qwen 专用分支（两步下拉菜单交互：chat.qwen.ai / qwen.ai / tongyi.aliyun.com）
    if (
      currentHost.includes("qwen.ai") ||
      currentHost.includes("qwen.com") ||
      currentHost.includes("tongyi.aliyun.com")
    ) {
      return this.tryQwenUpload(file, dataTransfer);
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
