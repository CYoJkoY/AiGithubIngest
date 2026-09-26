import { SupportedEditor, Result } from "../types";
import { ok, err } from "../core/result";
import { purgeExistingChips } from "./purifier";

export const detectUniversalEditor = (
  target: EventTarget | null,
): SupportedEditor | null => {
  if (!(target instanceof Element)) return null;

  // 1. 匹配标准 Textarea 容器 (如 ChatGPT, DeepSeek)
  const textarea = target.closest("textarea");
  if (
    textarea instanceof HTMLTextAreaElement &&
    !textarea.disabled &&
    !textarea.readOnly
  ) {
    return { kind: "textarea", element: textarea };
  }

  // 2. 匹配富文本容器 (如 Gemini, Claude, Quill, ProseMirror)
  const editableTarget = target.closest(
    '[contenteditable="true"], rich-textarea, .ProseMirror, .ql-editor',
  );
  if (editableTarget instanceof HTMLElement) {
    const actual = editableTarget.isContentEditable
      ? editableTarget
      : editableTarget.querySelector<HTMLElement>('[contenteditable="true"]');
    if (actual) return { kind: "contenteditable", element: actual };
  }

  return null;
};

export const writeUniversalText = (
  editor: SupportedEditor,
  text: string,
): Result<void, Error> => {
  try {
    if (editor.kind === "textarea") {
      const el = editor.element;
      el.focus();

      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? el.value.length;
      el.setRangeText(text, start, end, "end");

      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return ok(undefined);
    }

    const el = editor.element;
    el.focus();
    purgeExistingChips(el);

    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const inserted = document.execCommand("insertText", false, text);

    if (!inserted || !el.textContent?.includes(text.slice(0, 15))) {
      el.innerHTML = "";
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      el.appendChild(paragraph);

      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error("写入内容失败"));
  }
};
