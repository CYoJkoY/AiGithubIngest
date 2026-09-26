import { IngestFileResult, RepoTarget } from "../types";

export const SEPARATOR = "=".repeat(48);

export class OutputFormatter {
  public static createSummaryPrefix(
    target: RepoTarget,
    branch: string,
    fileCount: number,
    estimatedTokens: string,
  ): string {
    const lines: string[] = [];

    lines.push(`Repository: ${target.owner}/${target.repo}`);

    if (branch && branch !== "main" && branch !== "master") {
      lines.push(`Branch: ${branch}`);
    }

    if (target.subpath && target.subpath !== "/") {
      lines.push(`Subpath: ${target.subpath}`);
    }

    lines.push(`Files analyzed: ${fileCount}`);
    lines.push(`Estimated tokens: ${estimatedTokens}`);

    return lines.join("\n") + "\n";
  }

  public static buildFullDigest(
    summaryPrefix: string,
    treeText: string,
    files: readonly IngestFileResult[],
  ): string {
    let output = summaryPrefix + "\n";
    output += `Directory structure:\n${treeText}\n\n`;

    for (const f of files) {
      output += `${SEPARATOR}\nFILE: ${f.path}\n${SEPARATOR}\n${f.content}\n\n`;
    }

    return output;
  }
}
