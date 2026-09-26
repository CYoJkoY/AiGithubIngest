export interface CursorSnapshot {
  start: number;
  end: number;
  originalText?: string;
  range?: Range;
}

export class SafeInputAdapter {
  /**
   * 获取当前光标位置快照
   */
  public static captureSnapshot(element: HTMLElement): CursorSnapshot {
    if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement
    ) {
      return {
        start: element.selectionStart ?? element.value.length,
        end: element.selectionEnd ?? element.value.length,
      };
    }

    // 针对 ContentEditable 元素
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      return {
        start: 0,
        end: 0,
        range: selection.getRangeAt(0).cloneRange(),
      };
    }

    return { start: 0, end: 0 };
  }

  /**
   * 在光标选区处无损插入文本，保证不破坏光标前后的已有内容
   */
  public static insertAtCursor(
    element: HTMLElement,
    textToInsert: string,
    snapshot: CursorSnapshot,
  ): void {
    element.focus();

    // 1. Textarea / Input 模式：基于切片拼接，绝不覆盖已有文本
    if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement
    ) {
      const currentVal = element.value;
      const before = currentVal.substring(0, snapshot.start);
      const after = currentVal.substring(snapshot.end);

      element.value = `${before}${textToInsert}${after}`;

      // 恢复光标位置到插入内容之后
      const newCursorPos = snapshot.start + textToInsert.length;
      element.setSelectionRange(newCursorPos, newCursorPos);

      // 触发合成事件，通知 React/Vue 更新受控状态
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // 2. ContentEditable 模式：通过 Range 或 execCommand 精准插入
    if (element.isContentEditable) {
      const selection = window.getSelection();
      if (snapshot.range && selection) {
        selection.removeAllRanges();
        selection.addRange(snapshot.range);
      }

      // 优先使用浏览器标准命令，可安全融入宿主富文本框架的历史栈
      const success = document.execCommand("insertText", false, textToInsert);
      if (!success && snapshot.range) {
        snapshot.range.deleteContents();
        const textNode = document.createTextNode(textToInsert);
        snapshot.range.insertNode(textNode);
        snapshot.range.setStartAfter(textNode);
        snapshot.range.collapse(true);
      }

      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  /**
   * 故障回滚：当提取失败时，将原始文本安全归还到输入框
   */
  public static rollbackToRawText(
    element: HTMLElement,
    rawClipboardText: string,
    snapshot: CursorSnapshot,
  ): void {
    SafeInputAdapter.insertAtCursor(element, rawClipboardText, snapshot);
  }
}
