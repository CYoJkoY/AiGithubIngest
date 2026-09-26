/**
 * 现代输入框增量安全写入器
 * 适配 textarea、input 以及 contenteditable (ProseMirror / Monaco / Slate)
 */
export class UniversalEditor {
  /**
   * 将文本安全插入到当前光标所在位置，绝不覆写已存在的前后文本
   */
  public static insertAtCursor(
    text: string,
    fallbackTarget?: EventTarget | null,
  ): boolean {
    let activeEl = document.activeElement as HTMLElement | null;

    if (
      (!activeEl || activeEl === document.body) &&
      fallbackTarget instanceof HTMLElement
    ) {
      fallbackTarget.focus();
      activeEl = fallbackTarget;
    }

    // 优先使用标准命令，自动保留撤销历史，兼容受控组件与富文本输入框
    const success = document.execCommand("insertText", false, text);
    if (success) {
      return true;
    }

    // 针对原生 textarea/input 在特定环境下 execCommand 失效的降级处理
    if (
      activeEl instanceof HTMLTextAreaElement ||
      activeEl instanceof HTMLInputElement
    ) {
      const start = activeEl.selectionStart ?? activeEl.value.length;
      const end = activeEl.selectionEnd ?? activeEl.value.length;
      const originalValue = activeEl.value;

      activeEl.value =
        originalValue.slice(0, start) + text + originalValue.slice(end);
      const newCursorPos = start + text.length;
      activeEl.setSelectionRange(newCursorPos, newCursorPos);

      activeEl.dispatchEvent(new Event("input", { bubbles: true }));
      activeEl.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return false;
  }
}

export const insertAtCursor = (
  text: string,
  fallbackTarget?: EventTarget | null,
): boolean => {
  return UniversalEditor.insertAtCursor(text, fallbackTarget);
};
