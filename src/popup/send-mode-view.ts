import { t } from '../core/i18n';
import { DEFAULT_DIGEST_SEND_MODE } from '../core/constants';
import { DigestSendMode, StorageSchema, SupportedLang } from '../types';
import { StorageService } from './storage-service';

/**
 * SEC. 02 — 摘要交付方式
 *
 * A two-state segmented control following the browser-extension UX pattern:
 * the current mode is always visible, the consequence of each mode is spelled
 * out before the user commits to it, and the failure behaviour is stated
 * explicitly rather than left to discovery.
 */

const OPTION_IDS: Readonly<Record<DigestSendMode, string>> = {
  'real-file': 'send-mode-real',
  'pseudo-file': 'send-mode-pseudo',
};

const MODES = ['real-file', 'pseudo-file'] as const satisfies readonly DigestSendMode[];

let listenersBound = false;
/**
 * The refresh callback from the most recent render.
 *
 * Handlers are attached once, so they read the callback at click time instead
 * of closing over whichever `onUpdate` happened to be current when the
 * listener was created.
 */
let refresh: (() => Promise<void>) | null = null;

function optionEl(mode: DigestSendMode): HTMLElement | null {
  return document.getElementById(OPTION_IDS[mode]);
}

function makeFactRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'wabi-meta-field';

  const dt = document.createElement('dt');
  dt.textContent = label;

  const dd = document.createElement('dd');
  dd.textContent = value;

  row.append(dt, dd);
  return row;
}

function renderFacts(mode: DigestSendMode, lang: SupportedLang): void {
  const container = document.getElementById('send-mode-facts');
  if (!container) return;
  container.textContent = '';

  container.append(
    makeFactRow(
      t('sendModeFactMode', lang),
      t(mode === 'pseudo-file' ? 'sendModePseudoFile' : 'sendModeRealFile', lang),
    ),
    makeFactRow(
      t('sendModeFactPayload', lang),
      t(mode === 'pseudo-file' ? 'sendModeFactPseudo' : 'sendModeFactReal', lang),
    ),
    makeFactRow(t('sendModeFactRisk', lang), t('sendModeFactRiskValue', lang)),
  );
}

/**
 * Attach the click handlers exactly once.
 *
 * Re-rendering after every storage write would otherwise stack a duplicate
 * listener on each button. The callback is therefore read from `refresh` at
 * click time rather than captured here.
 */
function bindOnce(): void {
  if (listenersBound) return;

  for (const mode of MODES) {
    const el = optionEl(mode);
    if (!el) continue;
    el.addEventListener('click', () => {
      void (async () => {
        await StorageService.setDigestSendMode(mode);
        await refresh?.();
      })();
    });
  }
  listenersBound = true;
}

export function renderSendMode(
  storage: StorageSchema,
  currentLang: SupportedLang,
  onUpdate: () => Promise<void>,
): void {
  refresh = onUpdate;
  const mode: DigestSendMode = storage.digestSendMode ?? DEFAULT_DIGEST_SEND_MODE;

  const realEl = optionEl('real-file');
  const pseudoEl = optionEl('pseudo-file');
  if (realEl) realEl.textContent = t('sendModeRealFile', currentLang);
  if (pseudoEl) pseudoEl.textContent = t('sendModePseudoFile', currentLang);

  for (const candidate of MODES) {
    const el = optionEl(candidate);
    if (!el) continue;
    const selected = candidate === mode;
    el.setAttribute('aria-checked', String(selected));
    el.setAttribute('aria-pressed', String(selected));
  }

  const hint = document.getElementById('lbl-send-mode-hint');
  if (hint) {
    const detail = t(
      mode === 'pseudo-file' ? 'sendModePseudoDesc' : 'sendModeRealDesc',
      currentLang,
    );
    hint.textContent = `${t('sendModeHint', currentLang)} ${detail}`;
  }

  renderFacts(mode, currentLang);
  bindOnce();
}
