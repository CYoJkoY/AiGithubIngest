export const INGEST_TIMEOUT_MS = 15000;
export const ADAPTER_TIMEOUT_MS = 5000;
export const CLEANUP_DELAY_MS = 4000;

const MB = 1024 * 1024;

/**
 * Per-hostname single-file size limits (bytes).
 *
 * These are the platform-imposed hard limits for a single attachment.
 * Users may override any of them via the popup UI; unlisted sites fall
 * back to {@link DEFAULT_FILE_SIZE_LIMIT}.
 */
export const DEFAULT_SITE_FILE_SIZE_LIMITS: Readonly<Record<string, number>> = {
  // International platforms
  'chatgpt.com': 512 * MB,
  'chat.openai.com': 512 * MB,
  'claude.ai': 32 * MB,
  'gemini.google.com': 100 * MB,
  'chat.deepseek.com': 100 * MB,
  'poe.com': 100 * MB,
  'perplexity.ai': 100 * MB,
  'copilot.microsoft.com': 100 * MB,
  'grok.com': 100 * MB,
  // Chinese platforms
  'doubao.com': 10 * MB,
  'qwen.ai': 10 * MB,
  'chat.qwen.ai': 10 * MB,
  'qianwen.com': 10 * MB,
  'tongyi.aliyun.com': 10 * MB,
  'yuanbao.tencent.com': 10 * MB,
  'yuanbao.com': 10 * MB,
  'kimi.moonshot.cn': 20 * MB,
  'chatglm.cn': 20 * MB,
  'chat.z.ai': 20 * MB,
  'z.ai': 20 * MB,
  'bigmodel.cn': 20 * MB,
};

/** Fallback for any platform not listed in {@link DEFAULT_SITE_FILE_SIZE_LIMITS}. */
export const DEFAULT_FILE_SIZE_LIMIT = 20 * MB;
