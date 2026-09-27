import { IngestFileResult, RepoTarget } from '../types';

export const SEPARATOR = '='.repeat(48);

const encoder = new TextEncoder();

function byteLength(s: string): number {
  return encoder.encode(s).length;
}

export interface DigestPart {
  /** e.g. `owner_repo.md` or `owner_repo.part1of3.md` */
  readonly fileName: string;
  readonly content: string;
  readonly sizeBytes: number;
}

function splitByLines(content: string, maxBytes: number): string[] {
  const lines = content.split('\n');
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const line of lines) {
    const lineBytes = byteLength(line) + 1; // account for the '\n'
    if (currentBytes + lineBytes > maxBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += `${line}\n`;
    currentBytes += lineBytes;
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

function finalizeParts(rawParts: readonly string[], baseFileName: string): DigestPart[] {
  if (rawParts.length <= 1) {
    const content = rawParts[0] ?? '';
    return [{ fileName: `${baseFileName}.md`, content, sizeBytes: byteLength(content) }];
  }
  const n = rawParts.length;
  return rawParts.map((content, i) => ({
    fileName: `${baseFileName}.part${i + 1}of${n}.md`,
    content,
    sizeBytes: byteLength(content),
  }));
}

export class OutputFormatter {
  public static createSummaryPrefix(
    target: RepoTarget,
    branch: string,
    fileCount: number,
    estimatedTokens: string,
  ): string {
    const lines: string[] = [];

    lines.push(`Repository: ${target.owner}/${target.repo}`);

    if (branch && branch !== 'main' && branch !== 'master') {
      lines.push(`Branch: ${branch}`);
    }

    if (target.subpath && target.subpath !== '/') {
      lines.push(`Subpath: ${target.subpath}`);
    }

    lines.push(`Files analyzed: ${fileCount}`);
    lines.push(`Estimated tokens: ${estimatedTokens}`);

    return lines.join('\n') + '\n';
  }

  public static buildFullDigest(
    summaryPrefix: string,
    treeText: string,
    files: readonly IngestFileResult[],
  ): string {
    let output = summaryPrefix + '\n';
    output += `Directory structure:\n${treeText}\n\n`;

    for (const f of files) {
      output += `${SEPARATOR}\nFILE: ${f.path}\n${SEPARATOR}\n${f.content}\n\n`;
    }

    return output;
  }

  /**
   * Split a full repository digest into one or more size-bounded parts.
   *
   * - Every part repeats the summary prefix + directory tree header so the AI
   *   can interpret each part independently.
   * - Files are accumulated until adding the next one would cross `maxBytesPerPart`.
   * - When a single file is larger than the remaining budget, it is split at
   *   line boundaries with `[CONTINUED …]` / `[END OF FILE]` markers.
   */
  public static splitIntoParts(
    summaryPrefix: string,
    treeText: string,
    files: readonly IngestFileResult[],
    maxBytesPerPart: number,
    baseFileName: string,
  ): DigestPart[] {
    const header = `${summaryPrefix}\nDirectory structure:\n${treeText}\n\n`;
    const headerBytes = byteLength(header);
    const budget = Math.max(maxBytesPerPart - headerBytes, 1024);

    const parts: string[] = [];
    let current = header;
    let currentBytes = headerBytes;

    const flush = (): void => {
      if (current.length > header.length) {
        parts.push(current);
      }
      current = header;
      currentBytes = headerBytes;
    };

    for (const f of files) {
      const block = `${SEPARATOR}\nFILE: ${f.path}\n${SEPARATOR}\n${f.content}\n\n`;
      const blockBytes = byteLength(block);

      if (blockBytes <= budget) {
        if (currentBytes + blockBytes > maxBytesPerPart && current.length > header.length) {
          flush();
        }
        current += block;
        currentBytes += blockBytes;
        continue;
      }

      // A single file exceeds the remaining budget → split at line boundaries.
      flush();

      const chunks = splitByLines(block, budget);
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const marker = isLast
          ? '\n[END OF FILE]\n'
          : `\n[CONTINUED — file ${f.path}, segment ${i + 1} of ${chunks.length}]\n`;
        const piece = chunks[i] + marker;

        if (!isLast) {
          parts.push(header + piece);
        } else {
          current = header + piece;
          currentBytes = byteLength(current);
        }
      }
    }

    if (current.length > header.length || parts.length === 0) {
      parts.push(current);
    }

    return finalizeParts(parts, baseFileName);
  }
}
