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

/** Code point boundary at or before `index`, never splitting a surrogate pair. */
function safeBoundary(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  const code = text.charCodeAt(index);
  const prev = text.charCodeAt(index - 1);
  const splitsPair = prev >= 0xd800 && prev <= 0xdbff && code >= 0xdc00 && code <= 0xdfff;
  return splitsPair ? index - 1 : index;
}

/** Largest index whose UTF-8 prefix fits in `maxBytes`. */
function fitBytes(text: string, maxBytes: number): number {
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 4 : codePoint > 0x7ff ? 3 : codePoint > 0x7f ? 2 : 1;
    if (bytes + width > maxBytes) break;
    bytes += width;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return index;
}

function splitAtNewlines(text: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = fitBytes(text.slice(start), maxBytes) + start;
    if (end >= text.length) {
      parts.push(text.slice(start));
      break;
    }
    const boundary = safeBoundary(text, end);
    // Search only the fitted prefix: a newline at `boundary` itself lies past
    // the byte budget and must start the next part.
    const newline = text.lastIndexOf('\n', boundary - 1);
    const cut = newline > start ? newline + 1 : boundary;
    const guaranteed = cut > start ? cut : start + 1;
    parts.push(text.slice(start, guaranteed));
    start = guaranteed;
  }
  return parts.length > 0 ? parts : [''];
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

  /**
   * Split already-rendered Markdown into byte-bounded parts.
   *
   * Skeleton digests have no per-file bodies to rebuild, so splitting the
   * rendered text is the only lossless path. Concatenating every part must
   * reproduce the input exactly.
   */
  public static splitRenderedOutput(
    content: string,
    maxBytes: number,
    baseFileName: string,
  ): DigestPart[] {
    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 1;
    if (byteLength(content) <= limit) return finalizeParts([content], baseFileName);
    return finalizeParts(splitAtNewlines(content, limit), baseFileName);
  }
}
