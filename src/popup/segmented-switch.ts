/**
 * Two-state segmented switch.
 *
 * A pair of real `<button>`s rather than a checkbox + slider: both states are
 * focusable, keyboard-reachable, and announced by assistive tech without a
 * hidden input standing in for them.
 */

/**
 * `data-theme-value` → `dataset.themeValue`.
 *
 * Attribute selectors must be written in kebab-case while `dataset` lookups
 * need the camelCase form, so one helper owns the conversion instead of every
 * call site getting it right by hand.
 */
export function datasetKey(attribute: string): string {
  return attribute.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

/** Query the options of a switch wrapper by its kebab-case data attribute. */
export function querySwitchOptions(
  wrapper: HTMLElement,
  attribute: string,
): readonly HTMLElement[] {
  return Array.from(wrapper.querySelectorAll<HTMLElement>(`[data-${attribute}]`));
}

export function setupSegmentedSwitch(
  wrapperId: string,
  attribute: string,
  onPick: (value: string) => Promise<void>,
): void {
  const wrapper = document.getElementById(wrapperId);
  if (!wrapper) return;

  for (const option of querySwitchOptions(wrapper, attribute)) {
    option.addEventListener('click', () => {
      const value = option.dataset[datasetKey(attribute)];
      if (!value) return;
      void onPick(value);
    });
  }
}
