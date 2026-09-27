const TOKEN_THRESHOLDS: readonly [number, string][] = [
  [1_000_000, 'M'],
  [1_000, 'k'],
];

/** 匹配单词、非 ASCII 字符、标点、换行、空白块 */
const TOKEN_REGEX = /[a-zA-Z0-9_]+|\P{ASCII}|[\p{P}\p{S}]|\r?\n|[^\S\r\n]+/gu;

/** 匹配单个非 ASCII 字符（等价于 `[^\x00-\x7F]`，但不使用控制字符字面量） */
const NON_ASCII_REGEX = /\P{ASCII}/u;

/**
 * 启发式代码 Token 计数（贴近 GPT-4o / o200k_base 表现）
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  const matches = text.match(TOKEN_REGEX);
  if (!matches) {
    return Math.ceil(text.length / 4);
  }

  let count = 0;
  for (const token of matches) {
    // 非 ASCII 字符（汉字、表情等）通常占 1~2 个 Token
    if (NON_ASCII_REGEX.test(token)) {
      count += Math.ceil(token.length * 1.3);
    } else if (token.length > 8) {
      count += Math.ceil(token.length / 4);
    } else {
      count += 1;
    }
  }
  return count;
}

/**
 * Format a token count as a compact display string (e.g. 1.2k, 1.5M).
 */
export function formatTokenCount(text: string): string {
  const totalTokens = estimateTokenCount(text);

  for (const [threshold, suffix] of TOKEN_THRESHOLDS) {
    if (totalTokens >= threshold) {
      return `${(totalTokens / threshold).toFixed(1)}${suffix}`;
    }
  }

  return totalTokens.toString();
}
