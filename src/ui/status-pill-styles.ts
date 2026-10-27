/**
 * Styles for the status pill shadow root.
 *
 * The pill lives in a shadow tree, so this text is injected verbatim instead
 * of being registered through the manifest's content_scripts CSS. Every rule
 * stays inside the shadow boundary, and `all: initial` on the host keeps the
 * host page's design system out of the widget.
 */
export const STATUS_PILL_CSS = `
:host {
  all: initial;
  --aigi-pill-bg: #faf9f5;
  --aigi-pill-surface: #f1eee5;
  --aigi-pill-border: rgba(40, 36, 32, 0.18);
  --aigi-pill-text: #1c1a17;
  --aigi-pill-muted: #6f685d;
  --aigi-pill-accent: #3b5848;
  --aigi-pill-danger: #a6382a;
  --aigi-pill-focus: rgba(59, 88, 72, 0.42);
  --aigi-pill-font:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', sans-serif;
  --aigi-pill-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  display: inline-flex;
  flex-direction: column;
  align-self: flex-start;
  gap: 0;
  box-sizing: border-box;
  width: max-content;
  max-width: min(520px, calc(100vw - 32px));
  margin: 0 0 6px 2px;
  border: 1px solid var(--aigi-pill-border);
  border-radius: 2px;
  background: var(--aigi-pill-bg);
  box-shadow: 0 1px 3px rgba(40, 36, 32, 0.05);
  font-family: var(--aigi-pill-font);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
  color: var(--aigi-pill-text);
  text-align: start;
  direction: ltr;
  contain: layout paint;
  position: relative;
  z-index: 2147483000;
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 220ms cubic-bezier(0.25, 1, 0.4, 1),
    transform 220ms cubic-bezier(0.25, 1, 0.4, 1);
}

:host([data-placement='floating']) {
  position: fixed;
  left: 24px;
  bottom: 96px;
  margin: 0;
}

:host([data-aigi-theme='dark']) {
  --aigi-pill-bg: #1b1c20;
  --aigi-pill-surface: #25272d;
  --aigi-pill-border: rgba(240, 235, 225, 0.16);
  --aigi-pill-text: #edeae2;
  --aigi-pill-muted: #9a958b;
  --aigi-pill-accent: #7fa58f;
  --aigi-pill-danger: #e18072;
  --aigi-pill-focus: rgba(127, 165, 143, 0.5);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}

:host([data-state='error']) {
  --aigi-pill-accent: var(--aigi-pill-danger);
}

:host([data-leaving='true']) {
  opacity: 0;
  transform: translateY(-4px);
}

.aigi-status-pill__bar {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 5px 7px 5px 9px;
}

.aigi-status-pill__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--aigi-pill-accent);
}

:host([data-state='analyzing']) .aigi-status-pill__dot,
:host([data-state='retrying']) .aigi-status-pill__dot {
  animation: aigi-status-pill-pulse 1.4s ease-in-out infinite;
}

.aigi-status-pill__body {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  margin: 0;
  padding: 0;
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 0;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  text-align: start;
  cursor: default;
}

.aigi-status-pill__body[data-actionable='true'] {
  cursor: pointer;
}

.aigi-status-pill__body[data-actionable='true']:hover .aigi-status-pill__text {
  text-decoration: underline;
  text-decoration-color: var(--aigi-pill-border);
  text-underline-offset: 2px;
}

.aigi-status-pill__body:focus-visible {
  outline: 1px solid var(--aigi-pill-accent);
  outline-offset: 2px;
}

.aigi-status-pill__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.aigi-status-pill__chevron {
  flex: none;
  width: 5px;
  height: 5px;
  margin-top: -2px;
  border-right: 1px solid var(--aigi-pill-muted);
  border-bottom: 1px solid var(--aigi-pill-muted);
  transform: rotate(45deg);
  transition: transform 140ms ease;
}

.aigi-status-pill__body[aria-expanded='true'] .aigi-status-pill__chevron {
  margin-top: 2px;
  transform: rotate(225deg);
}

.aigi-status-pill__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
  color: var(--aigi-pill-muted);
  font-family: var(--aigi-pill-font);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.aigi-status-pill__close:hover {
  background: var(--aigi-pill-surface);
  color: var(--aigi-pill-text);
}

.aigi-status-pill__close:focus-visible {
  outline: 1px solid var(--aigi-pill-focus);
  outline-offset: 1px;
}

.aigi-status-pill__tray {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 9px 8px;
  border-top: 1px solid var(--aigi-pill-border);
}

.aigi-status-pill__actions,
.aigi-status-pill__subpath {
  display: flex;
  align-items: center;
  gap: 6px;
}

.aigi-status-pill__action {
  margin: 0;
  padding: 2px 9px;
  appearance: none;
  background: var(--aigi-pill-surface);
  border: 1px solid var(--aigi-pill-border);
  border-radius: 2px;
  color: var(--aigi-pill-text);
  font-family: var(--aigi-pill-font);
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
}

.aigi-status-pill__action:hover {
  border-color: var(--aigi-pill-accent);
}

.aigi-status-pill__action:focus-visible {
  outline: 1px solid var(--aigi-pill-focus);
  outline-offset: 1px;
}

.aigi-status-pill__action--primary {
  background: var(--aigi-pill-accent);
  border-color: var(--aigi-pill-accent);
  color: var(--aigi-pill-bg);
}

.aigi-status-pill__input {
  box-sizing: border-box;
  width: 180px;
  max-width: 55vw;
  margin: 0;
  padding: 3px 6px;
  appearance: none;
  background: var(--aigi-pill-bg);
  border: 1px solid var(--aigi-pill-border);
  border-radius: 2px;
  color: var(--aigi-pill-text);
  font-family: var(--aigi-pill-mono);
  font-size: 11px;
  line-height: 1.5;
}

.aigi-status-pill__input:focus {
  outline: 1px solid var(--aigi-pill-focus);
  outline-offset: 0;
  border-color: var(--aigi-pill-accent);
}

[hidden] {
  display: none !important;
}

@keyframes aigi-status-pill-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  :host,
  * {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
`;
