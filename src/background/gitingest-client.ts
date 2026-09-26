import { Result } from "../core/result";
import type {
  IngestRequestPayload,
  IngestResponsePayload,
  IngestError,
} from "../types/ingest";

const GITINGEST_API_ENDPOINT = "https://gitingest.com/api/ingest";
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 45000; // 大型仓库允许等待 45s

/**
 * 完整性守卫：验证返回内容是否为已渲染完毕的代码树，而非中间过渡页或空壳
 */
const validateDigestIntegrity = (
  payload: IngestResponsePayload,
): Result<string, IngestError> => {
  if (!payload.digest || payload.digest.trim().length === 0) {
    return Result.err({
      reason: "INCOMPLETE_DIGEST",
      message: "Gitingest 返回了空内容，可能仍在克隆队列中",
    });
  }

  // Gitingest 成功产物必然包含文件结构树标识或特定 Markdown 分割线
  const hasTreeSignature =
    payload.digest.includes("Directory structure:") || Boolean(payload.tree);
  if (!hasTreeSignature && payload.digest.length < 200) {
    return Result.err({
      reason: "INCOMPLETE_DIGEST",
      message: "返回内容未通过完整性校验，缺少 Directory structure 标识",
    });
  }

  return Result.ok(payload.digest);
};

/**
 * 延迟等待工具函数（避免依赖 Node 原生定时器模块）
 */
const waitDelay = (ms: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/**
 * 具备指数退避与完整性守卫的高可用请求器
 */
export const fetchCompletedDigest = async (
  requestParams: IngestRequestPayload,
): Promise<Result<string, IngestError>> => {
  let attemptIndex = 0;

  while (attemptIndex < MAX_RETRY_ATTEMPTS) {
    attemptIndex += 1;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      REQUEST_TIMEOUT_MS,
    );

    try {
      // 直接调用 JSON API，杜绝任何 HTML 动态抓取
      const httpResponse = await fetch(GITINGEST_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          url: requestParams.url,
          max_file_size: (requestParams.maxFileSizeKb ?? 50) * 1024,
          pattern: requestParams.pattern ?? "",
        }),
        signal: abortController.signal,
      });

      clearTimeout(timeoutHandle);

      // 处理服务端限流或排队
      if (httpResponse.status === 429) {
        if (attemptIndex < MAX_RETRY_ATTEMPTS) {
          await waitDelay(BASE_RETRY_DELAY_MS * attemptIndex);
          continue;
        }
        return Result.err({
          reason: "RATE_LIMITED",
          message: "Gitingest 接口触发频控限制，请稍后重试",
          statusCode: 429,
        });
      }

      if (!httpResponse.ok) {
        return Result.err({
          reason: "NETWORK_ERROR",
          message: `Gitingest 服务端返回异常状态: ${httpResponse.status}`,
          statusCode: httpResponse.status,
        });
      }

      const rawData = (await httpResponse.json()) as IngestResponsePayload;

      // 关键：校验数据是否彻底就绪
      const validationResult = validateDigestIntegrity(rawData);
      if (Result.isOk(validationResult)) {
        return validationResult;
      }

      // 未就绪但还有重试次数时等待下一次轮询
      if (attemptIndex < MAX_RETRY_ATTEMPTS) {
        await waitDelay(BASE_RETRY_DELAY_MS * attemptIndex);
        continue;
      }

      return validationResult;
    } catch (caughtException: unknown) {
      clearTimeout(timeoutHandle);

      const isAbortError =
        caughtException instanceof DOMException &&
        caughtException.name === "AbortError";
      if (isAbortError) {
        return Result.err({
          reason: "TIMEOUT",
          message: `解析超时（超过 ${REQUEST_TIMEOUT_MS / 1000}s），该仓库体量过大`,
        });
      }

      if (attemptIndex >= MAX_RETRY_ATTEMPTS) {
        const errorDetail =
          caughtException instanceof Error
            ? caughtException.message
            : String(caughtException);
        return Result.err({
          reason: "NETWORK_ERROR",
          message: `网络请求异常: ${errorDetail}`,
        });
      }

      await waitDelay(BASE_RETRY_DELAY_MS * attemptIndex);
    }
  }

  return Result.err({
    reason: "INCOMPLETE_DIGEST",
    message: "超过最大重试次数，未能获取到完整的解析产物",
  });
};
