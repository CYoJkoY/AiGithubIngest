// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PseudoFileManager } from './pseudo-file-manager';
import { PseudoFileRenderer } from './pseudo-file-renderer';
import { SubmitInterceptor } from './submit-interceptor';

describe('SubmitInterceptor Hardening Tests', () => {
  it('dispatches submit after splicing on Enter without leaving prompt stranded', async () => {
    const manager = new PseudoFileManager();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    const editor = document.createElement('textarea');
    document.body.appendChild(editor);
    renderer.mount(editor);

    const interceptor = new SubmitInterceptor(manager, renderer, { lang: 'zh-CN' });
    interceptor.attach(editor);

    manager.register('test.md', 'CONTENT');

    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    editor.dispatchEvent(keyEvent);

    expect(keyEvent.defaultPrevented).toBe(true);

    // 等待微任务让渡
    await new Promise((r) => setTimeout(r, 80));

    expect(editor.value).toContain('<file name="test.md">');
    expect(manager.count).toBe(0);
    interceptor.detach();
  });

  it('heals disconnected editor by querying activeElement dynamically', async () => {
    const manager = new PseudoFileManager();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    const oldEditor = document.createElement('textarea');
    document.body.appendChild(oldEditor);

    const interceptor = new SubmitInterceptor(manager, renderer, { lang: 'zh-CN' });
    interceptor.attach(oldEditor);

    manager.register('test.md', 'CONTENT');

    // 模拟 React 重建了输入框
    oldEditor.remove();
    const newEditor = document.createElement('textarea');
    document.body.appendChild(newEditor);
    newEditor.focus();

    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    newEditor.dispatchEvent(keyEvent);

    await new Promise((r) => setTimeout(r, 80));

    // 验证新输入框成功吸纳伪文件，无静默丢失
    expect(newEditor.value).toContain('<file name="test.md">');
    expect(manager.count).toBe(0);
    interceptor.detach();
  });
});
