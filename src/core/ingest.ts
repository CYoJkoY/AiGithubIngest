import { IngestOptions, IngestSummary, IngestFileResult } from "../types";
import { extractGitHubRepo } from "./parser";
import { GitHubEngine } from "./github-engine";
import { shouldIncludeFile } from "./file-filter";
import { TreeBuilder } from "./tree-builder";
import { OutputFormatter } from "./output-formatter";
import { formatTokenCount } from "./token-estimator";

export async function ingestRepository(
  rawUrl: string,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const parseResult = extractGitHubRepo(rawUrl);
  if (!parseResult.ok) {
    throw new Error(parseResult.error.message);
  }
  const target = parseResult.value;

  options.onProgress?.("正在检索 GitHub 仓库元数据...", 0, 1);
  const resolvedBranch = await GitHubEngine.resolveBranch(
    target,
    options.token,
  );

  options.onProgress?.(`正在获取仓库树结构 [${resolvedBranch}]...`, 0, 1);
  const rawTree = await GitHubEngine.fetchTree(
    target,
    resolvedBranch,
    options.token,
  );

  // 1. 过滤仅获取 Blob 文件节点
  let blobs = rawTree.filter((item) => item.type === "blob");

  // 2. 子目录范围限定
  if (target.subpath && target.subpath !== "/") {
    const prefix = target.subpath.replace(/^\/+|\/+$/g, "") + "/";
    blobs = blobs.filter((item) => item.path.startsWith(prefix));
  }

  // 3. 执行 Ignore 与体积排除规则
  const maxBytes = (options.maxFileSizeKb || 100) * 1024;
  const eligible = blobs.filter((item) =>
    shouldIncludeFile(
      item.path,
      item.size,
      maxBytes,
      options.includePatterns,
      options.excludePatterns,
    ),
  );

  if (eligible.length === 0) {
    throw new Error("经规则过滤后未匹配到任何符合条件的文本文件。");
  }

  // 4. 并发拉取文件内容（滑动窗口 6）
  const total = eligible.length;
  const files: IngestFileResult[] = [];
  const concurrency = 6;

  for (let i = 0; i < total; i += concurrency) {
    const chunk = eligible.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (file, idx) => {
        const current = i + idx + 1;
        options.onProgress?.(
          `提取代码文件中 (${current}/${total}): ${file.path}`,
          current,
          total,
        );
        try {
          const content = await GitHubEngine.fetchRawFile(
            target,
            resolvedBranch,
            file.path,
            options.token,
          );
          return {
            path: file.path,
            content,
            size: file.size ?? content.length,
          };
        } catch {
          // 遇到单个读取错误时不阻断整个流程
          return null;
        }
      }),
    );

    for (const r of results) {
      if (r) files.push(r);
    }
  }

  options.onProgress?.("正在构建结构树并估算 Token...", total, total);

  // 5. 内存构造和排序 ASCII 树
  const rootSlug = `${target.owner}-${target.repo}`;
  const treeRoot = TreeBuilder.build(
    files.map((f) => ({ path: f.path, size: f.size })),
    rootSlug,
  );
  const treeVisual = TreeBuilder.renderAscii(treeRoot);

  // 6. Token 估算与格式化合并
  const rawTextForToken =
    treeVisual + "\n" + files.map((f) => f.content).join("\n");
  const estimatedTokens = formatTokenCount(rawTextForToken);

  const summaryPrefix = OutputFormatter.createSummaryPrefix(
    target,
    resolvedBranch,
    files.length,
    estimatedTokens,
  );

  const formattedOutput = OutputFormatter.buildFullDigest(
    summaryPrefix,
    treeVisual,
    files,
  );

  return {
    repoInfo: target,
    resolvedBranch,
    treeVisual,
    files,
    formattedOutput,
    estimatedTokens,
  };
}
