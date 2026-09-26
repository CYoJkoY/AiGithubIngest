const CHIP_SELECTORS: readonly string[] = [
  '[contenteditable="false"]',
  ".chip",
  ".pill",
  "mat-chip",
  "[data-entity-type]",
];

export const purgeExistingChips = (root: Element): void => {
  try {
    const selector = CHIP_SELECTORS.join(",");
    const chips = root.querySelectorAll(selector);
    chips.forEach((el) => el.remove());
  } catch {
    // 防御性静默，防止在某些 Shadow DOM 遍历时报错
  }
};
