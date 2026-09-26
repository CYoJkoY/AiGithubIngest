import {
  IngestOptions,
  IngestSummary,
  IngestFileResult,
  RepoTarget,
} from "../types";
import { extractGitHubRepo } from "./parser";
import { GitHubEngine } from "./github-engine";
import { shouldIncludeFile } from "./file-filter";

export async function ingestRepository(
  rawUrl: string,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const parseResult = extractGitHubRepo(rawUrl);
  if (!parseResult.ok) {
    throw new Error(parseResult.error.message);
  }
  const target = parseResult.value;

  options.onProgress?.("正在检索仓库元数据...", 0, 1);
  const resolvedBranch = await GitHubEngine.resolveBranch(
    target,
    options.token,
  );

  options.onProgress?.(`正在解析目录结构 [${resolvedBranch}]...`, 0, 1);
  const rawTree = await GitHubEngine.fetchTree(
    target,
    resolvedBranch,
    options.token,
  );

  let blobs = rawTree.filter((item) => item.type === "blob");
  if (target.subpath) {
    const prefix = target.subpath.replace(/^\/+|\/+$/g, "") + "/";
    blobs = blobs.filter((item) => item.path.startsWith(prefix));
  }

  const maxBytes = (options.maxFileSizeKb || 100) * 1024;
  const eligible = blobs.filter((item) =>
    shouldIncludeFile(item.path, item.size, maxBytes),
  );

  const total = eligible.length;
  const files: IngestFileResult[] = [];
  const concurrency = 6;

  for (let i = 0; i < total; i += concurrency) {
    const chunk = eligible.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (file, idx) => {
        const current = i + idx + 1;
        options.onProgress?.(
          `提取文件中 (${current}/${total}): ${file.path}`,
          current,
          total,
        );
        try {
          const content = await GitHubEngine.fetchRawFile(
            target,
            resolvedBranch,
            file.path,
          );
          return {
            path: file.path,
            content,
            size: file.size || content.length,
          };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) files.push(r);
    }
  }

  let treeVisual = "Directory Structure:\n";
  eligible.forEach((f) => {
    treeVisual += `├── ${f.path}\n`;
  });

  let formattedOutput = `# Repository: ${target.owner}/${target.repo}\n`;
  formattedOutput += `# Branch: ${resolvedBranch}\n`;
  if (target.subpath) formattedOutput += `# Subpath: ${target.subpath}\n`;
  formattedOutput += `\n================================================\n${treeVisual}================================================\n\n`;

  for (const f of files) {
    formattedOutput += `================================================\nFile: ${f.path}\n================================================\n${f.content}\n\n`;
  }

  return {
    repoInfo: target,
    resolvedBranch,
    treeVisual,
    files,
    formattedOutput,
  };
}
