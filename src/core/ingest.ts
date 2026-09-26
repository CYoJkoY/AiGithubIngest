import { unzipSync } from "fflate";
import { IngestFileResult, IngestOptions, IngestSummary } from "../types";
import { extractGitHubRepo } from "./parser";
import { GitHubEngine } from "./github-engine";
import { shouldIncludeFile } from "./file-filter";
import { TreeBuilder } from "./tree-builder";
import { OutputFormatter } from "./output-formatter";
import { formatTokenCount } from "./token-estimator";

function isBinary(buffer: Uint8Array): boolean {
  const checkLen = Math.min(buffer.length, 1024);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export async function ingestRepository(
  rawUrl: string,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const parseResult = extractGitHubRepo(rawUrl);
  if (!parseResult.ok) {
    throw new Error(parseResult.error.message);
  }

  const target = parseResult.value;
  options.onProgress?.("正在解析分支信息...", 0, 100);
  const resolvedBranch = await GitHubEngine.resolveBranch(
    target,
    options.token,
  );

  options.onProgress?.("正在单次流式下载完整代码包 (Zipball)...", 20, 100);
  const zipBuffer = await GitHubEngine.fetchZipball(
    target,
    resolvedBranch,
    options.token,
  );

  options.onProgress?.("正在内存解压与过滤文件...", 60, 100);
  const unzipped = unzipSync(new Uint8Array(zipBuffer));
  const fileKeys = Object.keys(unzipped);

  if (fileKeys.length === 0) {
    throw new Error("仓库压缩包内容为空");
  }

  // GitHub Zipball 根目录结构固定为：{owner}-{repo}-{commit_hash}/
  const firstKey = fileKeys[0];
  const rootPrefix = firstKey.includes("/")
    ? firstKey.slice(0, firstKey.indexOf("/") + 1)
    : "";

  const subpathPrefix =
    target.subpath && target.subpath !== "/"
      ? target.subpath.replace(/^\/+|\/+$/g, "") + "/"
      : "";

  const treeFiles: Array<{ path: string; size: number }> = [];
  const processedFiles: IngestFileResult[] = [];
  const maxBytes = (options.maxFileSizeKb ?? 100) * 1024;
  const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

  for (const rawKey of fileKeys) {
    if (!rawKey.startsWith(rootPrefix)) continue;

    const relativePath = rawKey.slice(rootPrefix.length);
    // 忽略目录项或空路径
    if (!relativePath || relativePath.endsWith("/")) continue;

    // 子目录范围匹配
    if (subpathPrefix && !relativePath.startsWith(subpathPrefix)) {
      continue;
    }

    const fileData = unzipped[rawKey];
    const fileSize = fileData.length;

    // 规则过滤（.gitignore 默认项、自定义 exclude/include、大文件截断）
    if (
      !shouldIncludeFile(
        relativePath,
        fileSize,
        maxBytes,
        options.includePatterns,
        options.excludePatterns,
      )
    ) {
      continue;
    }

    treeFiles.push({ path: relativePath, size: fileSize });

    // 二进制文件安全处理
    if (isBinary(fileData)) {
      processedFiles.push({
        path: relativePath,
        content: "[Binary file]",
        size: fileSize,
      });
      continue;
    }

    const textContent = utf8Decoder.decode(fileData);
    processedFiles.push({
      path: relativePath,
      content: textContent,
      size: fileSize,
    });
  }

  options.onProgress?.("正在构建结构化目录树与上下文...", 90, 100);

  const rootSlug = `${target.owner}-${target.repo}`;
  const fileTree = TreeBuilder.build(treeFiles, rootSlug);
  const treeVisual = TreeBuilder.renderAscii(fileTree);

  // 预装配上下文大文本
  let rawContentPart = "";
  for (const f of processedFiles) {
    rawContentPart += `\n================================================\nFILE: ${f.path}\n================================================\n${f.content}\n`;
  }

  const estimatedTokens = formatTokenCount(treeVisual + rawContentPart);
  const summaryPrefix = OutputFormatter.createSummaryPrefix(
    target,
    resolvedBranch,
    processedFiles.length,
    estimatedTokens,
  );

  const formattedOutput = OutputFormatter.buildFullDigest(
    summaryPrefix,
    treeVisual,
    processedFiles,
  );

  return {
    repoInfo: target,
    resolvedBranch,
    treeVisual,
    files: processedFiles,
    formattedOutput,
    estimatedTokens,
  };
}
