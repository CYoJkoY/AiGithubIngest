import { describe, it, expect } from 'vitest';
import { t } from './i18n';

describe('t', () => {
  it('returns Chinese string by default', () => {
    expect(t('tokenSave')).toBe('保存');
  });

  it('returns English when lang=en', () => {
    expect(t('tokenSave', 'en')).toBe('Save');
  });

  it('interpolates {param} placeholders', () => {
    const s = t('ingesting', 'en', { repo: 'foo/bar' });
    expect(s).toContain('foo/bar');
    expect(s).not.toContain('{repo}');
  });

  it('falls back to key when unknown', () => {
    // @ts-expect-error intentionally invalid key
    expect(t('nonexistentKey', 'en')).toBe('nonexistentKey');
  });
});
