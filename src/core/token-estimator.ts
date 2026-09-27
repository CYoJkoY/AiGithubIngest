const TOKEN_THRESHOLDS: readonly [number, string][] = [
  [1_000_000, 'M'],
  [1_000, 'k'],
];

/**
 * 启发式代码 Token 计数（贴近 GPT-4o / o200k_base 表现）
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // 匹配单词、标点、长空白块及多字节字符
  const regex = /[a-zA-Z0-9_]+|[^\x00-\x7F]|[\p{P}\p{S}]|\r?\n|[^\S\r\n]+/gu;
  const matches = text.match(regex);
  if (!matches) {
    return Math.ceil(text.length / 4);
  }

  let count = 0;
  for (const token of matches) {
    // 非 ASCII 字符（汉字、表情等）通常占 1~2 个 Token
    if (/[^\x00-\x7F]/.test(token)) {
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
 * 格式化为与 Gitingest 完全一致的展示字符（例如 1.2k, 1.5M）
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
