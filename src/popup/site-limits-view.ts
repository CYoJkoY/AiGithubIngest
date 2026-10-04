import { t } from '../core/i18n';
import { StorageSchema, SupportedLang } from '../types';
import {
  DEFAULT_FILE_SIZE_LIMIT,
  MAX_FILE_SIZE_LIMIT,
  MIN_FILE_SIZE_LIMIT,
} from '../core/constants';
import { normalizeHostname } from '../core/policy';
import { logger } from '../core/logger';
import { StorageService } from './storage-service';

const KB = 1024;
const MB = 1024 * 1024;

type Unit = 'KB' | 'MB';

interface RowContext {
  readonly userLimits: Record<string, number>;
  readonly currentLang: SupportedLang;
  readonly onUpdate: () => Promise<void>;
}

function clampBytes(bytes: number): number {
  return Math.max(MIN_FILE_SIZE_LIMIT, Math.min(MAX_FILE_SIZE_LIMIT, bytes));
}

function pickUnit(bytes: number): Unit {
  return bytes >= MB ? 'MB' : 'KB';
}

function formatValue(bytes: number, unit: Unit): string {
  if (unit === 'MB') {
    const mb = bytes / MB;
    if (Number.isInteger(mb)) return String(mb);
    return mb.toFixed(2).replace(/\.?0+$/, '');
  }
  return String(Math.max(1, Math.round(bytes / KB)));
}

function toBytes(value: number, unit: Unit): number {
  return Math.round(value * (unit === 'MB' ? MB : KB));
}

async function resolveCurrentHostname(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    try {
      return normalizeHostname(new URL(tab.url).hostname);
    } catch {
      return null;
    }
  } catch (err) {
    logger.debug('resolveCurrentHostname failed', err);
    return null;
  }
}

function makeSectionTitle(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'site-limit-section';
  el.textContent = text;
  return el;
}

function makeEmptyTip(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty-tip';
  el.textContent = text;
  return el;
}

function makeUnitSelect(initial: Unit): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'select-box site-limit-unit';
  select.setAttribute('aria-label', 'Unit');
  for (const u of ['KB', 'MB'] as const) {
    const opt = document.createElement('option');
    opt.value = u;
    opt.textContent = u;
    select.appendChild(opt);
  }
  select.value = initial;
  return select;
}

function makeNumberInput(bytes: number, unit: Unit): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = unit === 'MB' ? '0.01' : '1';
  input.step = unit === 'MB' ? '0.5' : '1';
  input.className = 'wabi-input wabi-input--mono site-limit-input';
  input.value = formatValue(bytes, unit);
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

function attachUnitConversion(
  input: HTMLInputElement,
  select: HTMLSelectElement,
  initialUnit: Unit,
): void {
  let activeUnit = initialUnit;
  select.addEventListener('change', () => {
    const newUnit = select.value as Unit;
    const parsed = Number.parseFloat(input.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const bytes = toBytes(parsed, activeUnit);
      input.value = formatValue(bytes, newUnit);
    }
    activeUnit = newUnit;
    input.min = newUnit === 'MB' ? '0.01' : '1';
    input.step = newUnit === 'MB' ? '0.5' : '1';
  });
}

function makeIconButton(
  glyph: string,
  title: string,
  onClick: () => void,
  variant: 'save' | 'remove',
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `wabi-icon-button site-limit-icon-btn site-limit-icon-btn--${variant}`;
  btn.textContent = glyph;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', onClick);
  return btn;
}

async function saveSiteLimit(
  host: string,
  rawValue: string,
  unit: Unit,
  ctx: RowContext,
): Promise<void> {
  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  const bytes = clampBytes(toBytes(parsed, unit));
  await StorageService.saveSiteLimit(host, bytes);
  await ctx.onUpdate();
}

async function removeSiteLimit(host: string, ctx: RowContext): Promise<void> {
  await StorageService.removeSiteLimit(host);
  await ctx.onUpdate();
}

async function saveFallbackLimit(rawValue: string, unit: Unit, ctx: RowContext): Promise<void> {
  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  const bytes = clampBytes(toBytes(parsed, unit));
  await StorageService.saveFallbackLimit(bytes);
  await ctx.onUpdate();
}

async function addSiteLimit(
  domainInput: HTMLInputElement,
  sizeInput: HTMLInputElement,
  unitSelect: HTMLSelectElement,
  ctx: RowContext,
): Promise<void> {
  const rawDomain = domainInput.value.trim();
  if (!rawDomain) return;

  let host: string;
  try {
    host = rawDomain.includes('://')
      ? normalizeHostname(new URL(rawDomain).hostname)
      : normalizeHostname(rawDomain);
  } catch {
    host = normalizeHostname(rawDomain);
  }
  if (!host || host.length < 3) return;

  const parsed = Number.parseFloat(sizeInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) return;

  const bytes = clampBytes(toBytes(parsed, unitSelect.value as Unit));
  await StorageService.saveSiteLimit(host, bytes);
  await ctx.onUpdate();
}

function buildConfiguredRow(
  host: string,
  bytes: number,
  ctx: RowContext,
  highlight: boolean,
): HTMLElement {
  const row = document.createElement('div');
  row.className = highlight ? 'site-limit-row site-limit-row--current' : 'site-limit-row';

  const label = document.createElement('span');
  label.className = 'site-limit-label';
  label.textContent = host;
  label.title = host;
  row.appendChild(label);

  const unit = pickUnit(bytes);
  const input = makeNumberInput(bytes, unit);
  row.appendChild(input);

  const select = makeUnitSelect(unit);
  attachUnitConversion(input, select, unit);
  row.appendChild(select);

  const saveBtn = makeIconButton(
    '✓',
    t('siteFileLimitSaveBtn', ctx.currentLang),
    () => void saveSiteLimit(host, input.value, select.value as Unit, ctx),
    'save',
  );
  row.appendChild(saveBtn);

  const removeBtn = makeIconButton(
    '×',
    t('siteFileLimitRemoveBtn', ctx.currentLang),
    () => void removeSiteLimit(host, ctx),
    'remove',
  );
  row.appendChild(removeBtn);

  return row;
}

function buildUnsetCurrentRow(host: string, ctx: RowContext): HTMLElement {
  const row = document.createElement('div');
  row.className = 'site-limit-row site-limit-row--current site-limit-row--unset';

  const label = document.createElement('span');
  label.className = 'site-limit-label';
  label.textContent = host;
  label.title = host;
  row.appendChild(label);

  const bytes = DEFAULT_FILE_SIZE_LIMIT;
  const unit = pickUnit(bytes);
  const input = makeNumberInput(bytes, unit);
  row.appendChild(input);

  const select = makeUnitSelect(unit);
  attachUnitConversion(input, select, unit);
  row.appendChild(select);

  const saveBtn = makeIconButton(
    '✓',
    t('siteFileLimitSaveBtn', ctx.currentLang),
    () => void saveSiteLimit(host, input.value, select.value as Unit, ctx),
    'save',
  );
  row.appendChild(saveBtn);

  return row;
}

function buildFallbackRow(bytes: number, ctx: RowContext): HTMLElement {
  const row = document.createElement('div');
  row.className = 'site-limit-row site-limit-row--fallback';

  const bytesValue = bytes > 0 ? bytes : DEFAULT_FILE_SIZE_LIMIT;
  const unit = pickUnit(bytesValue);
  const input = makeNumberInput(bytesValue, unit);
  row.appendChild(input);

  const select = makeUnitSelect(unit);
  attachUnitConversion(input, select, unit);
  row.appendChild(select);

  const saveBtn = makeIconButton(
    '✓',
    t('siteFileLimitSaveBtn', ctx.currentLang),
    () => void saveFallbackLimit(input.value, select.value as Unit, ctx),
    'save',
  );
  row.appendChild(saveBtn);

  return row;
}

function buildAddRow(currentHost: string | null, ctx: RowContext): HTMLElement {
  const row = document.createElement('div');
  row.className = 'site-limit-row site-limit-row--add';

  const domainInput = document.createElement('input');
  domainInput.type = 'text';
  domainInput.className = 'wabi-input wabi-input--mono site-limit-domain';
  domainInput.placeholder = t('siteFileLimitDomainPlaceholder', ctx.currentLang);
  domainInput.autocomplete = 'off';
  domainInput.spellcheck = false;
  if (currentHost && !(currentHost in ctx.userLimits)) {
    domainInput.value = currentHost;
  }
  row.appendChild(domainInput);

  const bytes = DEFAULT_FILE_SIZE_LIMIT;
  const unit = pickUnit(bytes);
  const sizeInput = makeNumberInput(bytes, unit);
  row.appendChild(sizeInput);

  const select = makeUnitSelect(unit);
  attachUnitConversion(sizeInput, select, unit);
  row.appendChild(select);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'wabi-button wabi-button--ghost site-limit-add-btn';
  addBtn.textContent = t('siteFileLimitAddBtn', ctx.currentLang);
  addBtn.addEventListener('click', () => {
    void addSiteLimit(domainInput, sizeInput, select, ctx);
  });
  row.appendChild(addBtn);

  return row;
}

export async function renderSiteLimits(
  storage: StorageSchema,
  currentLang: SupportedLang,
  onUpdate: () => Promise<void>,
): Promise<void> {
  const container = document.getElementById('site-limits-list');
  if (!container) return;

  const userLimits = { ...(storage.siteFileSizeLimits ?? {}) };
  const defaultBytes = storage.defaultFileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT;
  const currentHost = await resolveCurrentHostname();

  // Clearing happens *after* the await, so two overlapping renders resolve
  // last-writer-wins instead of appending two copies of the list.
  container.innerHTML = '';
  const ctx: RowContext = { userLimits, currentLang, onUpdate };

  if (currentHost) {
    container.appendChild(makeSectionTitle(t('siteFileLimitCurrentSite', currentLang)));
    const configuredBytes = userLimits[currentHost];
    container.appendChild(
      configuredBytes
        ? buildConfiguredRow(currentHost, configuredBytes, ctx, true)
        : buildUnsetCurrentRow(currentHost, ctx),
    );
  }

  const otherHosts = Object.keys(userLimits)
    .filter((h) => h !== currentHost)
    .sort();
  container.appendChild(makeSectionTitle(t('siteFileLimitConfigured', currentLang)));
  if (otherHosts.length === 0) {
    container.appendChild(makeEmptyTip(t('siteFileLimitEmpty', currentLang)));
  } else {
    for (const host of otherHosts) {
      container.appendChild(buildConfiguredRow(host, userLimits[host], ctx, false));
    }
  }

  container.appendChild(makeSectionTitle(t('siteFileLimitAddTitle', currentLang)));
  container.appendChild(buildAddRow(currentHost, ctx));

  container.appendChild(makeSectionTitle(t('siteFileLimitFallback', currentLang)));
  container.appendChild(buildFallbackRow(defaultBytes, ctx));
}
