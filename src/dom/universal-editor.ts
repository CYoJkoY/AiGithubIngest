export class UniversalEditor {
  /**
   * 在当前光标处安全插入文本，绝不冲刷、不修改已存在的任何字符
   */
  public static insertAtCursor(
    text: string,
    fallbackTarget?: EventTarget | null,
  ): boolean {
    const activeEl = (
      fallbackTarget instanceof HTMLElement
        ? fallbackTarget
        : document.activeElement
    ) as HTMLElement | null;

    if (!activeEl) return false;

    // 1. 原生 Textarea / Input 元素（适配 React 受控组件）
    if (
      activeEl instanceof HTMLTextAreaElement ||
      activeEl instanceof HTMLInputElement
    ) {
      const start = activeEl.selectionStart ?? activeEl.value.length;
      const end = activeEl.selectionEnd ?? activeEl.value.length;
      const originalValue = activeEl.value;
      const updatedValue =
        originalValue.slice(0, start) + text + originalValue.slice(end);

      // 通过原型链 Setter 绕过 React 拦截，促使 React 状态管理器正常响应
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

      activeEl.selectionStart = activeEl.selectionEnd = start + text.length;
      activeEl.dispatchEvent(new Event("input", { bubbles: true }));
      activeEl.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // 2. 现代 AI 站点的 contenteditable 容器 (ChatGPT / Claude / Gemini / DeepSeek)
    if (
      activeEl.isContentEditable ||
      activeEl.closest("[contenteditable='true']")
    ) {
      const editableContainer = activeEl.isContentEditable
        ? activeEl
        : (activeEl.closest("[contenteditable='true']") as HTMLElement);

      editableContainer.focus();

      // 优先使用标准 beforeinput 事件（ProseMirror 与 Lexical 标准输入接口）
      const canInputEvent = typeof InputEvent === "function";
      if (canInputEvent) {
        const inputEvent = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        });
        const notCancelled = editableContainer.dispatchEvent(inputEvent);
        if (!notCancelled) return true;
      }

      // 回退使用浏览器级命令
      return document.execCommand("insertText", false, text);
    }

    return false;
  }
}
