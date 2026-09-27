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

    // 安装捕获阶段的 click 拦截器：阻止浏览器弹出系统文件选择器。
    // 捕获阶段在 document 上会先于豆包任何监听器执行，因此 100% 拦截。
    // 仅拦截目标为 file input 的 click，不影响其他元素。
    const clickBlocker = (e: Event): void => {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === "file") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener("click", clickBlocker, true);

    // 兼容 patch：部分 Chrome 版本可能走 showPicker 路径
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

    // 派发合成 click 触发 React onClick，让豆包渲染出 input
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

    // 3. 延迟扫描新出现的 input 并挂载文件
    setTimeout(() => {
      const newInput = document.querySelector<HTMLInputElement>(
        'input[data-testid="upload-file-input"], input[type="file"]',
      );

      if (newInput && this.isValidFileInput(newInput, file)) {
        this.mountFileToInput(newInput, dataTransfer);
      }
    }, 200);

    // 4. 1 秒后移除拦截器和恢复 patch，保证用户后续操作完全正常
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
   * 必须模拟完整的两步链路，否则 input 永远不会被创建。
   *
   * 同时安装捕获阶段 click 拦截器 + showPicker patch，阻止系统文件选择
   * 器真正弹出，保证自动化流程对用户完全静默。
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

    // 5. 派发合成 click 到 "+" 按钮 → 触发 Ant Design dropdown 展开
    try {
      modeBtn.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    } catch {
      // 容错处理
    }

    // 6. 等待菜单渲染后点击 "上传附件" 菜单项
    let menuItemClicked = false;
    const clickMenuItem = (): void => {
      if (menuItemClicked) return;
      const menuItem = this.findQwenUploadMenuItem();
      if (!menuItem) return;
      menuItemClicked = true;
      try {
        menuItem.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      } catch {
        // 容错处理
      }
    };

    const timers: Array<ReturnType<typeof setTimeout>> = [];

    // 6a. 300ms 首次点击（覆盖同步渲染）
    timers.push(setTimeout(clickMenuItem, 300));
    // 6b. 700ms 二次点击（覆盖异步 chunk 渲染）
    timers.push(setTimeout(clickMenuItem, 700));

    // 7. 多段扫描新创建的 input 并挂载
    const tryMount = (): void => {
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
          return;
        }
      }
    };
    timers.push(setTimeout(tryMount, 500)); // 对应首次点击
    timers.push(setTimeout(tryMount, 900)); // 对应二次点击
    timers.push(setTimeout(tryMount, 1400)); // 慢速兜底
    timers.push(setTimeout(tryMount, 2000)); // 最慢路径

    // 8. 2.5s 后统一清理拦截器与 patch，恢复用户后续手动操作
    timers.push(
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
      }, 2500),
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
