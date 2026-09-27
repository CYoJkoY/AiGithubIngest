import { SiteAdapter } from './types';
import { CLEANUP_DELAY_MS } from '../../core/constants';
import { mountFilesToInput } from './show-picker-guard';
import type { Logger } from '../../core/logger';

/**
 * 递归穿透 Shadow DOM 收集所有匹配的 file input。
 *
 * 部分站点（如 Gemini / Angular 自定义元素）将 <input type="file">
 * 封装在 open Shadow Root 内部，普通 querySelectorAll 无法穿透边界。
 * 该函数先扫描当前节点的 light DOM，再对所有含 shadowRoot 的子节点递归。
 *
 * 说明：closed Shadow Root 无法通过脚本访问，此处只处理 open 模式。
 */
function queryFileInputsDeep(root: ParentNode): HTMLInputElement[] {
  const results: HTMLInputElement[] = [];

  const walk = (node: ParentNode): void => {
    node.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((el) => {
      results.push(el);
    });

    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  };

  walk(root);
  return results;
}

function isValidFileInput(input: HTMLInputElement, file: File): boolean {
  if (input.disabled) return false;
  const accept = input.accept?.trim();
  if (!accept) return true;

  const acceptLower = accept.toLowerCase();
  const isPureMedia =
    (acceptLower.includes('image/') ||
      acceptLower.includes('.jpg') ||
      acceptLower.includes('.png')) &&
    !acceptLower.includes('text') &&
    !acceptLower.includes('.txt') &&
    !acceptLower.includes('.doc') &&
    !acceptLower.includes('.pdf') &&
    !acceptLower.includes('*');
  if (isPureMedia) return false;

  const acceptPatterns = acceptLower
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (acceptPatterns.length === 0) return true;

  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  return acceptPatterns.some((pattern) => {
    if (pattern === '*/*' || pattern === '*') return true;
    if (
      pattern === '.txt' ||
      pattern === 'text/plain' ||
      pattern === '.md' ||
      pattern === '.markdown' ||
      pattern === 'text/markdown' ||
      pattern === '.doc' ||
      pattern === '.docx' ||
      pattern === '.pdf' ||
      pattern.includes('document')
    ) {
      return true;
    }
    if (pattern.startsWith('.')) return fileName.endsWith(pattern);
    if (pattern.endsWith('/*')) {
      const mimeCategory = pattern.slice(0, pattern.indexOf('/'));
      return fileType.startsWith(`${mimeCategory}/`) || mimeCategory === 'text';
    }
    return fileType === pattern;
  });
}

function cleanUpFileInput(fileInput: HTMLInputElement, logger: Logger): void {
  try {
    const emptyDT = new DataTransfer();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (descriptor?.set) descriptor.set.call(fileInput, emptyDT.files);
    else fileInput.files = emptyDT.files;
    fileInput.value = '';
    const tracker = (fileInput as unknown as { _valueTracker?: { setValue: (v: string) => void } })
      ._valueTracker;
    if (tracker) tracker.setValue('');
  } catch (err) {
    logger.debug('cleanUpFileInput failed', err);
  }
}

/**
 * 条件清理：只在「宿主确实没有消费这个 input」时清空它。
 *
 * 之前的实现是无条件 setTimeout 到 CLEANUP_DELAY_MS 后清空 files + value，
 * 这对异步读取 input.files 的宿主框架（React concurrent、Angular zone 等）不友好：
 * 附件预览可能已经渲染出来，4 秒后再被清空，观感就是「附件闪一下又没了」。
 *
 * 现在改为：4 秒后检查页面上是否出现了任何附件预览节点。
 *   - 有预览：宿主已消费，保留现场不动。
 *   - 无预览：认为未被消费，主动清理以恢复 input 可重复使用性。
 */
function scheduleConditionalCleanup(input: HTMLInputElement, logger: Logger): void {
  setTimeout(() => {
    try {
      if (!input.isConnected) return; // input 已被宿主移除
      if (!input.files || input.files.length === 0) return; // 宿主已自行清空

      const hasPreview = document.querySelector(
        [
          'uploader-file-preview',
          '[class*="attachment" i]',
          '[class*="file-chip" i]',
          '[class*="upload-chip" i]',
          '[class*="file-preview" i]',
          '[class*="uploaded" i]',
        ].join(','),
      );
      if (hasPreview) return;

      cleanUpFileInput(input, logger);
    } catch (err) {
      logger.debug('scheduleConditionalCleanup failed', err);
    }
  }, CLEANUP_DELAY_MS);
}

export const genericFileInputAdapter: SiteAdapter = {
  id: 'generic-file-input',
  matches: () => true,
  attach: async (file, ctx) => {
    const { dataTransfer, activeElement, logger } = ctx;

    const scopes = [
      activeElement?.closest('form'),
      activeElement?.closest('[class*="chat"]'),
      activeElement?.closest('[class*="input"]'),
      activeElement?.closest('[class*="editor"]'),
      activeElement?.closest('[class*="prompt"]'),
      activeElement?.closest('[role="presentation"]'),
      activeElement?.parentElement?.parentElement,
      document.querySelector('[role="main"]'),
      document.querySelector('main'),
      document.querySelector('#root'),
      document.querySelector('#app'),
      document.body,
    ].filter((scope): scope is Element => Boolean(scope));

    for (const scope of scopes) {
      const inputs = queryFileInputsDeep(scope);
      for (const input of inputs) {
        if (!isValidFileInput(input, file)) continue;
        if (mountFilesToInput(input, dataTransfer, logger)) {
          scheduleConditionalCleanup(input, logger);
          return { success: true, method: 'file-input' };
        }
      }
    }

    // 全局兜底：同样需要穿透 Shadow DOM
    const globalInputs = queryFileInputsDeep(document);
    for (const input of globalInputs) {
      if (!isValidFileInput(input, file)) continue;
      if (mountFilesToInput(input, dataTransfer, logger)) {
        scheduleConditionalCleanup(input, logger);
        return { success: true, method: 'file-input-global' };
      }
    }

    return { success: false, method: 'file-input' };
  },
};
